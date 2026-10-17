import { resolve, join } from 'node:path';
import * as readline from 'node:readline';
import { BridgeRegistry } from './bridge-registry.js';
import { BridgeValidator } from './bridge-validator.js';
import { PermissionManager } from './permissions.js';
import { GitExecutor } from './executors/git-executor.js';
import { StandardStepExecutor, YouTubeExecutor } from './executors/index.js';
import { GoogleOAuthService } from './auth/google-oauth.js';
import { McpManager } from './mcp/mcp-manager.js';
import { IntegrationCatalog } from './catalog.js';

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
  private googleOAuth: GoogleOAuthService;
  private mcpManager: McpManager;
  private catalog: IntegrationCatalog;

  constructor(
    bridgesDir = BRIDGES_DIR,
    googleOAuth = new GoogleOAuthService(),
    mcpManager?: McpManager,
  ) {
    this.registry = new BridgeRegistry(bridgesDir);
    this.validator = new BridgeValidator();
    this.permissions = new PermissionManager();
    this.gitExecutor = new GitExecutor();
    this.googleOAuth = googleOAuth;
    this.mcpManager = mcpManager || new McpManager({ permissions: this.permissions });
    this.stepExecutor = new StandardStepExecutor({
      gitExecutor: this.gitExecutor,
      mcpManager: this.mcpManager,
      youtubeExecutor: new YouTubeExecutor({ googleOAuth: this.googleOAuth }),
    });
    this.catalog = new IntegrationCatalog(this.registry, this.mcpManager, this.gitExecutor, this.googleOAuth);
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
                {
                  name: 'agentforge_list_catalog',
                  description: 'Get the unified integration catalog of bridges, external MCP servers, declared capabilities, and verified executable tools.',
                  inputSchema: {
                    type: 'object',
                    properties: {},
                  },
                },
                {
                  name: 'agentforge_list_mcp_servers',
                  description: 'List all configured external MCP servers, connection status, health, and discovered tools.',
                  inputSchema: {
                    type: 'object',
                    properties: {},
                  },
                },
                {
                  name: 'agentforge_manage_mcp_server',
                  description: 'Manage external MCP servers (list, connect, disconnect, ping, add, remove).',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      action: {
                        type: 'string',
                        enum: ['list', 'connect', 'disconnect', 'ping', 'add', 'remove'],
                        description: 'Operation to perform',
                      },
                      serverId: { type: 'string', description: 'Target MCP server ID' },
                      config: { type: 'object', description: 'Configuration payload when adding a server' },
                    },
                    required: ['action'],
                  },
                },
                {
                  name: 'agentforge_run_mcp_tool',
                  description: 'Safely execute an approved tool on a connected external MCP server with input schema validation and permission enforcement.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      serverId: { type: 'string', description: 'Target MCP server ID' },
                      toolName: { type: 'string', description: 'Name of the tool to execute' },
                      inputs: { type: 'object', description: 'Input arguments for the tool' },
                    },
                    required: ['serverId', 'toolName'],
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

        const googleStatus = await this.googleOAuth.getStatus();

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
          google: {
            clientConfigured: googleStatus.clientConfigured,
            clientValidation: googleStatus.clientValidation,
            clientValidationError: googleStatus.clientValidationError,
            clientVerified: googleStatus.clientVerified,
            accountConnected: googleStatus.accountConnected,
            connectedAccount: googleStatus.connectedAccount,
            status: googleStatus.status,
            onboardingState: googleStatus.onboardingState,
            actionRequiredReason: googleStatus.actionRequiredReason,
            grantedScopes: googleStatus.grantedScopes,
            available: googleStatus.available,
            storageBackend: googleStatus.storageBackend,
            note: googleStatus.note,
          },
          youtube: {
            available: Boolean(googleStatus.accountConnected && (await this.googleOAuth.isYouTubeAuthorized())),
            configured: googleStatus.clientConfigured,
            connected: Boolean(googleStatus.accountConnected),
            hasScope: await this.googleOAuth.isYouTubeAuthorized(),
            connectedAccount: googleStatus.connectedAccount,
            note: !googleStatus.accountConnected
              ? 'Requires Google Account connection. Run "agentforge auth youtube".'
              : !(await this.googleOAuth.isYouTubeAuthorized())
              ? 'Connected to Google, but YouTube read-only scope not granted. Run "agentforge auth youtube".'
              : `Connected via Google Account (${googleStatus.connectedAccount}) with YouTube read-only scope.`,
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

      case 'agentforge_list_catalog': {
        return this.catalog.getCatalog();
      }

      case 'agentforge_list_mcp_servers': {
        const servers = this.mcpManager.listServers();
        return { count: servers.length, servers };
      }

      case 'agentforge_manage_mcp_server': {
        const action = String(args.action || '');
        const serverId = args.serverId ? String(args.serverId) : '';

        switch (action) {
          case 'list':
            return this.mcpManager.listServers();

          case 'connect':
            if (!serverId) throw new Error('serverId is required for "connect"');
            return this.mcpManager.connectServer(serverId);

          case 'disconnect':
            if (!serverId) throw new Error('serverId is required for "disconnect"');
            return this.mcpManager.disconnectServer(serverId);

          case 'ping':
            if (!serverId) throw new Error('serverId is required for "ping"');
            return { serverId, alive: await this.mcpManager.pingServer(serverId) };

          case 'add': {
            const config = (args.config as any) || {};
            if (!config.id && serverId) config.id = serverId;
            const server = await this.mcpManager.addServer(config);
            return { status: 'success', action: 'add', server };
          }

          case 'remove': {
            if (!serverId) throw new Error('serverId is required for "remove"');
            const removed = await this.mcpManager.removeServer(serverId);
            return { status: 'success', action: 'remove', serverId, removed };
          }

          default:
            throw new Error(`Unknown manage action: "${action}". Supported: list, connect, disconnect, ping, add, remove`);
        }
      }

      case 'agentforge_run_mcp_tool': {
        const serverId = String(args.serverId || '');
        const toolName = String(args.toolName || '');
        const inputs = (args.inputs as Record<string, unknown>) || {};

        if (!serverId || !toolName) {
          throw new Error('Both serverId and toolName are required to execute an external MCP tool');
        }

        return this.mcpManager.callTool(serverId, toolName, inputs);
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
