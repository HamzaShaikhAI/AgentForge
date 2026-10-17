import {
  McpClient,
  McpServerConfig,
  McpServerState,
  McpServerStatus,
  McpDiscoveredTool,
  inferToolPermission,
} from './types.js';

export class HttpMcpClient implements McpClient {
  readonly id: string;
  readonly config: McpServerConfig;
  private status: McpServerStatus = 'disconnected';
  private error?: string;
  private connectedAt?: string;
  private serverInfo?: { name: string; version: string };
  private tools: McpDiscoveredTool[] = [];
  private nextRequestId = 1;

  constructor(config: McpServerConfig) {
    if (!config.id || !config.id.trim()) {
      throw new Error('MCP server ID cannot be empty');
    }
    if (!config.url || !config.url.trim()) {
      throw new Error('MCP server URL cannot be empty for HTTP transport');
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(config.url);
    } catch {
      throw new Error(`Invalid MCP server URL: "${config.url}"`);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`Invalid MCP server URL: "${config.url}". Only http: and https: protocols are permitted.`);
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
    const redactedConfig = { ...this.config };
    if (redactedConfig.headers) {
      const safeHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(redactedConfig.headers)) {
        if (/auth|token|key|secret|cookie/i.test(key)) {
          safeHeaders[key] = '[REDACTED]';
        } else {
          safeHeaders[key] = value;
        }
      }
      redactedConfig.headers = safeHeaders;
    }

    return {
      id: this.id,
      name: this.config.name,
      description: this.config.description,
      transport: 'http',
      status: this.status,
      error: this.error,
      connectedAt: this.connectedAt,
      serverInfo: this.serverInfo,
      tools: [...this.tools],
      config: redactedConfig,
      url: this.config.url,
    };
  }

  async connect(): Promise<void> {
    this.status = 'connecting';
    this.error = undefined;

    try {
      const initResult = (await this.sendPost('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'AgentForge', version: '0.1.0' },
      })) as {
        protocolVersion?: string;
        capabilities?: Record<string, unknown>;
        serverInfo?: { name: string; version: string };
      };

      if (initResult?.serverInfo) {
        this.serverInfo = {
          name: String(initResult.serverInfo.name || 'unknown'),
          version: String(initResult.serverInfo.version || '0.0.0'),
        };
      }

      // Send notifications/initialized notification per MCP protocol
      await this.sendNotification('notifications/initialized');

      await this.listTools();

      this.status = 'connected';
      this.connectedAt = new Date().toISOString();
    } catch (err) {
      this.status = 'error';
      this.error = `HTTP connection failed: ${(err as Error).message}`;
      throw new Error(this.error);
    }
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    this.tools = [];
  }

  async listTools(): Promise<McpDiscoveredTool[]> {
    if (this.status !== 'connected' && this.status !== 'connecting') {
      throw new Error(`Cannot list tools: server is ${this.status}`);
    }

    const response = (await this.sendPost('tools/list', {})) as {
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

    const response = (await this.sendPost('tools/call', {
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
      await this.sendPost('ping', {});
      return true;
    } catch {
      return false;
    }
  }

  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    try {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        method,
        ...(params ? { params } : {}),
      });
      await fetch(this.config.url!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.headers || {}),
        },
        body,
        redirect: 'error',
      });
    } catch {
      // ignore notification errors
    }
  }

  private async sendPost(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextRequestId++;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const resp = await fetch(this.config.url!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(this.config.headers || {}),
        },
        body,
        signal: controller.signal,
        redirect: 'error',
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }

      const json = (await resp.json()) as {
        id?: number | string;
        result?: unknown;
        error?: { code: number; message: string };
      };

      if (json.error) {
        throw new Error(json.error.message || `RPC Error code ${json.error.code}`);
      }

      return json.result;
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`HTTP MCP request "${method}" timed out after ${this.config.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
