import { resolve, join } from 'node:path';
import * as readline from 'node:readline';
import { BridgeRegistry } from './bridge-registry.js';
import { BridgeValidator } from './bridge-validator.js';
import { PermissionManager } from './permissions.js';
import { GitExecutor } from './executors/git-executor.js';
import { StandardStepExecutor } from './executors/index.js';

const ROOT = resolve(import.meta.dirname, '..');
const BRIDGES_DIR = join(ROOT, 'bridges');

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class AgentForgeMcpServer {
  private registry: BridgeRegistry;
  private validator: BridgeValidator;
  private permissions: PermissionManager;
  private gitExecutor: GitExecutor;
  private stepExecutor: StandardStepExecutor;

  constructor(bridgesDir = BRIDGES_DIR) {
    this.registry = new BridgeRegistry(bridgesDir);
    this.validator = new BridgeValidator();
    this.permissions = new PermissionManager();
    this.gitExecutor = new GitExecutor();
    this.stepExecutor = new StandardStepExecutor(this.gitExecutor);
  }

  async handleMessage(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;

    // Notifications (no response required)
    if (req.method === 'notifications/initialized') {
      return null;
    }

    try {
      switch (req.method) {
        case 'initialize': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: 'agentforge',
                version: '0.1.0',
              },
            },
          };
        }

        case 'ping': {
          return { jsonrpc: '2.0', id, result: {} };
        }

        case 'tools/list': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: [
                {
                  name: 'agentforge_list_bridges',
                  description: 'List all installed AgentForge bridges, their capabilities, and integration requirements.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      category: { type: 'string', description: 'Optional category filter' },
                    },
                  },
                },
                {
                  name: 'agentforge_check_integrations',
                  description: 'Check the health and availability of external tools and credentials for all bridges.',
                  inputSchema: {
                    type: 'object',
                    properties: {},
                  },
                },
                {
                  name: 'agentforge_run_action',
                  description: 'Execute a safe action on an AgentForge bridge (e.g. github repo-info, github status-check). Respects permission tiers and approval policies.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      bridge: { type: 'string', description: 'Bridge name (e.g. "github", "example-echo")' },
                      action: { type: 'string', description: 'Action name (e.g. "status-check", "repo-info")' },
                      inputs: { type: 'object', description: 'Input parameters for the action' },
                    },
                    required: ['bridge', 'action'],
                  },
                },
                {
                  name: 'agentforge_validate_manifest',
                  description: 'Validate a bridge manifest JSON against schema v1.0.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      manifestJson: { type: 'string', description: 'JSON string of the manifest' },
                    },
                    required: ['manifestJson'],
                  },
                },
              ],
            },
          };
        }

        case 'tools/call': {
          const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined;
          if (!params || !params.name) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'Invalid params: tool name required' },
            };
          }

          const toolResult = await this.callTool(params.name, params.arguments || {});
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2),
                },
              ],
              isError: false,
            },
          };
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          };
      }
    } catch (err: unknown) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Error executing tool: ${(err as Error).message}`,
            },
          ],
          isError: true,
        },
      };
    }
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'agentforge_list_bridges': {
        await this.registry.discover();
        if (typeof args.category === 'string') {
          return this.registry.listByCategory(args.category).map(e => e.manifest);
        }
        return this.registry.list().map(e => ({
          name: e.manifest.name,
          displayName: e.manifest.displayName,
          version: e.manifest.version,
          category: e.manifest.category,
          description: e.manifest.description,
          capabilitiesCount: e.manifest.capabilities.length,
          integrations: e.manifest.integrations.map(i => `${i.name} (${i.required ? 'required' : 'optional'})`),
        }));
      }

      case 'agentforge_check_integrations': {
        let gitAvailable = false;
        let gitVersion = '';
        try {
          const res = await this.gitExecutor.runGit(['--version']);
          gitAvailable = true;
          gitVersion = res.stdout;
        } catch {
          // not found
        }

        return {
          git: {
            available: gitAvailable,
            version: gitVersion,
            requiredBy: ['github'],
          },
          githubCli: {
            available: false,
            version: null,
            requiredBy: [],
            optionalFor: ['github'],
            note: 'Not installed. Fallback to git CLI + GITHUB_TOKEN.',
          },
          githubToken: {
            configured: Boolean(process.env.GITHUB_TOKEN),
            requiredBy: [],
            optionalFor: ['github (remote releases)'],
          },
        };
      }

      case 'agentforge_validate_manifest': {
        const json = String(args.manifestJson || '');
        return this.validator.validateJSON(json);
      }

      case 'agentforge_run_action': {
        const bridgeName = String(args.bridge || '');
        const action = String(args.action || '');
        const inputs = (args.inputs as Record<string, unknown>) || {};

        await this.registry.discover();
        const bridge = this.registry.get(bridgeName);
        if (!bridge) {
          throw new Error(`Bridge "${bridgeName}" not found in registry`);
        }

        // Permission check
        const permCheck = this.permissions.checkPermission(bridge.manifest, action, inputs);
        if (!permCheck.allowed) {
          return {
            status: 'blocked',
            level: permCheck.level,
            requiresApproval: permCheck.requiresApproval,
            reason: permCheck.reason,
            note: 'Explicit user approval required before executing this action.',
          };
        }

        // Execute via step executor
        const output = await this.stepExecutor.execute(
          {
            id: `call-${Date.now()}`,
            name: `${bridgeName}.${action}`,
            bridge: bridgeName,
            action,
            inputs,
          },
          inputs,
        );

        return {
          status: 'success',
          bridge: bridgeName,
          action,
          output,
          timestamp: new Date().toISOString(),
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /**
   * Start listening on stdin/stdout for MCP JSON-RPC messages.
   */
  startStdio(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', async line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req = JSON.parse(trimmed) as JsonRpcRequest;
        const res = await this.handleMessage(req);
        if (res) {
          process.stdout.write(JSON.stringify(res) + '\n');
        }
      } catch (err) {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${(err as Error).message}`,
          },
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    });

    process.stderr.write('AgentForge MCP server running on stdio\n');
  }
}

// Direct execution entrypoint
if (process.argv[1]?.endsWith('mcp-server.ts') || process.argv[1]?.endsWith('mcp-server.js')) {
  const server = new AgentForgeMcpServer();
  server.startStdio();
}
