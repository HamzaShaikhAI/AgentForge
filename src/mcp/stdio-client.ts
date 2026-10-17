import { spawn, ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import {
  McpClient,
  McpServerConfig,
  McpServerState,
  McpServerStatus,
  McpDiscoveredTool,
  inferToolPermission,
} from './types.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class StdioMcpClient implements McpClient {
  readonly id: string;
  readonly config: McpServerConfig;
  private process: ChildProcess | null = null;
  private status: McpServerStatus = 'disconnected';
  private error?: string;
  private connectedAt?: string;
  private serverInfo?: { name: string; version: string };
  private tools: McpDiscoveredTool[] = [];
  private nextRequestId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();

  constructor(config: McpServerConfig) {
    if (!config.id || !config.id.trim()) {
      throw new Error('MCP server ID cannot be empty');
    }
    if (!config.command || !config.command.trim()) {
      throw new Error('MCP server command cannot be empty for stdio transport');
    }
    this.id = config.id.trim();
    this.config = {
      ...config,
      timeoutMs: config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : 15000,
    };
  }

  getStatus(): McpServerStatus {
    return this.status;
  }

  getState(): McpServerState {
    // Redact sensitive environment variables in the exported state
    const redactedConfig = { ...this.config };
    if (redactedConfig.env) {
      const safeEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(redactedConfig.env)) {
        if (/token|key|secret|password|auth|credential/i.test(key)) {
          safeEnv[key] = '[REDACTED]';
        } else {
          safeEnv[key] = value;
        }
      }
      redactedConfig.env = safeEnv;
    }

    return {
      id: this.id,
      name: this.config.name,
      description: this.config.description,
      transport: 'stdio',
      status: this.status,
      error: this.error,
      connectedAt: this.connectedAt,
      serverInfo: this.serverInfo,
      tools: [...this.tools],
      config: redactedConfig,
      env: redactedConfig.env,
      command: this.config.command,
    };
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' && this.process) {
      return;
    }

    this.status = 'connecting';
    this.error = undefined;

    return new Promise<void>((resolve, reject) => {
      let isResolved = false;

      try {
        const mergedEnv = {
          ...process.env,
          ...(this.config.env || {}),
        };

        let command = this.config.command!;
        if (process.platform === 'win32') {
          if (command === 'npx') command = 'npx.cmd';
          if (command === 'npm') command = 'npm.cmd';
        }

        this.process = spawn(command, this.config.args || [], {
          env: mergedEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true,
        });

        this.process.on('error', err => {
          this.status = 'error';
          this.error = `Process spawn failed: ${err.message}`;
          this.cleanupAllPending(new Error(this.error));
          if (!isResolved) {
            isResolved = true;
            reject(new Error(this.error));
          }
        });

        this.process.on('exit', (code, signal) => {
          const reason = signal ? `killed by signal ${signal}` : `exited with code ${code}`;
          this.status = code === 0 ? 'disconnected' : 'error';
          this.error = `MCP server process ${reason}`;
          this.cleanupAllPending(new Error(this.error));
          this.process = null;
          if (!isResolved) {
            isResolved = true;
            reject(new Error(this.error));
          }
        });

        // Setup readline on stdout
        const rl = readline.createInterface({
          input: this.process.stdout!,
          terminal: false,
        });

        rl.on('line', line => {
          this.handleIncomingLine(line);
        });

        // Initialize handshake
        this.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'AgentForge', version: '0.1.0' },
        })
          .then(async (initResult: unknown) => {
            const result = initResult as { serverInfo?: { name: string; version: string } };
            if (result?.serverInfo) {
              this.serverInfo = {
                name: String(result.serverInfo.name || 'unknown'),
                version: String(result.serverInfo.version || '0.0.0'),
              };
            }

            // Send notifications/initialized
            this.sendNotification('notifications/initialized');

            // Discover available tools
            await this.listTools();

            this.status = 'connected';
            this.connectedAt = new Date().toISOString();
            if (!isResolved) {
              isResolved = true;
              resolve();
            }
          })
          .catch(err => {
            this.status = 'error';
            this.error = `MCP handshake failed: ${(err as Error).message}`;
            if (this.process) {
              try {
                this.process.kill();
              } catch {
                // ignore
              }
              this.process = null;
            }
            if (!isResolved) {
              isResolved = true;
              reject(new Error(this.error));
            }
          });
      } catch (err) {
        this.status = 'error';
        this.error = `Failed to start server: ${(err as Error).message}`;
        if (!isResolved) {
          isResolved = true;
          reject(new Error(this.error));
        }
      }
    });
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    this.cleanupAllPending(new Error('MCP server disconnected'));

    if (this.process) {
      const proc = this.process;
      this.process = null;

      try {
        proc.kill('SIGTERM');
        // Force kill if still open after 1 second
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, 1000).unref();
      } catch {
        // ignore
      }
    }
  }

  async listTools(): Promise<McpDiscoveredTool[]> {
    if (this.status !== 'connected' && this.status !== 'connecting') {
      throw new Error(`Cannot list tools: server is ${this.status}`);
    }

    const response = (await this.sendRequest('tools/list', {})) as {
      tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>;
    };

    if (!response || !Array.isArray(response.tools)) {
      this.tools = [];
      return [];
    }

    this.tools = response.tools
      .filter(t => Boolean(t && typeof t.name === 'string' && t.name.trim()))
      .map(t => {
        const name = String(t.name).trim();
        const description = t.description ? String(t.description) : '';
        const permission = inferToolPermission(name, description);
        return {
          name,
          description,
          inputSchema: t.inputSchema || { type: 'object', properties: {} },
          permissionLevel: permission.level,
          requiresApproval: permission.requiresApproval,
        };
      });

    return [...this.tools];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.status !== 'connected') {
      throw new Error(`MCP server "${this.id}" is not connected (current status: ${this.status})`);
    }

    const response = (await this.sendRequest('tools/call', {
      name,
      arguments: args,
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    if (response?.isError) {
      const errorMsg =
        response.content && response.content.length > 0
          ? response.content.map(c => c.text || '').join('\n')
          : 'Tool returned error status';
      throw new Error(`External tool error (${name}): ${errorMsg}`);
    }

    if (response?.content && Array.isArray(response.content)) {
      return response;
    }

    return { content: [{ type: 'text', text: typeof response === 'string' ? response : JSON.stringify(response) }] };
  }

  async ping(): Promise<boolean> {
    if (this.status !== 'connected') return false;
    try {
      await this.sendRequest('ping', {});
      return true;
    } catch {
      return false;
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.process || !this.process.stdin || this.process.stdin.destroyed) {
      throw new Error('Server process is not running or stdin is closed');
    }

    const id = this.nextRequestId++;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request "${method}" (ID: ${id}) timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.process!.stdin!.write(JSON.stringify(message) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.process || !this.process.stdin || this.process.stdin.destroyed) {
      return;
    }
    const message = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };
    try {
      this.process.stdin.write(JSON.stringify(message) + '\n');
    } catch {
      // ignore notification write failures
    }
  }

  private handleIncomingLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const data = JSON.parse(trimmed) as {
        jsonrpc: string;
        id?: number | string;
        result?: unknown;
        error?: { code: number; message: string; data?: unknown };
      };

      if (data.id !== undefined && this.pendingRequests.has(data.id)) {
        const pending = this.pendingRequests.get(data.id)!;
        this.pendingRequests.delete(data.id);
        clearTimeout(pending.timer);

        if (data.error) {
          pending.reject(new Error(data.error.message || `RPC Error code ${data.error.code}`));
        } else {
          pending.resolve(data.result);
        }
      }
    } catch {
      // Ignore unparseable non-JSON output (e.g. process banner logs)
    }
  }

  private cleanupAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
