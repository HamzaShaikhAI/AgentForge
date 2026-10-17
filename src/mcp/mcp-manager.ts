import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  McpClient,
  McpServerConfig,
  McpServerState,
  McpDiscoveredTool,
} from './types.js';
import { StdioMcpClient } from './stdio-client.js';
import { HttpMcpClient } from './http-client.js';
import {
  CredentialStore,
  getDefaultCredentialStore,
  getAgentForgeDataDir,
} from '../auth/index.js';
import { PermissionManager, PermissionCheckResult } from '../permissions.js';

export interface CallToolResult {
  status: 'success' | 'blocked' | 'error';
  serverId: string;
  toolName: string;
  output?: unknown;
  permission?: PermissionCheckResult;
  error?: string;
  timestamp: string;
}

export class McpManager {
  private clients = new Map<string, McpClient>();
  private storagePath: string;
  private permissions: PermissionManager;
  private credentialStore: CredentialStore;

  constructor(
    options:
      | string
      | {
          storagePath?: string;
          permissions?: PermissionManager;
          credentialStore?: CredentialStore;
        } = {},
  ) {
    if (typeof options === 'string') {
      this.storagePath = options;
      this.permissions = new PermissionManager();
      this.credentialStore = getDefaultCredentialStore();
    } else {
      this.storagePath =
        options.storagePath || join(getAgentForgeDataDir(), 'mcp-servers.json');
      this.permissions = options.permissions || new PermissionManager();
      this.credentialStore = options.credentialStore || getDefaultCredentialStore();
    }
  }

  setPermissionManager(permissions: PermissionManager): void {
    this.permissions = permissions;
  }

  getPermissionManager(): PermissionManager {
    return this.permissions;
  }

  /**
   * Load stored server configurations from persistent storage.
   * Restores protected secrets from the OS secure credential store.
   */
  async loadConfiguredServers(): Promise<void> {
    if (!existsSync(this.storagePath)) {
      return;
    }

    try {
      const raw = await readFile(this.storagePath, 'utf-8');
      const configs = JSON.parse(raw) as McpServerConfig[];
      if (Array.isArray(configs)) {
        for (const cfg of configs) {
          if (cfg && cfg.id && !this.clients.has(cfg.id)) {
            // Restore protected secrets from secure credential store
            try {
              const stored = await this.credentialStore.load(`mcp_${cfg.id}`);
              const extra = stored?.extraData as
                | { env?: Record<string, string>; headers?: Record<string, string> }
                | undefined;

              if (extra) {
                if (extra.env && cfg.env) {
                  for (const [k, v] of Object.entries(extra.env)) {
                    if (cfg.env[k] === '[SECURE_STORE]') {
                      cfg.env[k] = v;
                    }
                  }
                }
                if (extra.headers && cfg.headers) {
                  for (const [k, v] of Object.entries(extra.headers)) {
                    if (cfg.headers[k] === '[SECURE_STORE]') {
                      cfg.headers[k] = v;
                    }
                  }
                }
              }
            } catch {
              // ignore credential retrieval errors
            }

            const client = this.createClient(cfg);
            this.clients.set(cfg.id, client);
            if (cfg.autoConnect) {
              client.connect().catch(() => {});
            }
          }
        }
      }
    } catch {
      // Ignore unparseable configs or missing file
    }
  }

  /**
   * Persist current server configurations to disk.
   * Protects sensitive environment variables and headers in the OS secure storage.
   */
  async persistConfiguredServers(): Promise<void> {
    try {
      const targetDir = dirname(this.storagePath);
      await mkdir(targetDir, { recursive: true });
      const configsToPersist: McpServerConfig[] = [];

      for (const client of this.clients.values()) {
        const rawConfig = client.config;
        const persistedConfig: McpServerConfig = { ...rawConfig };
        const secretEnv: Record<string, string> = {};
        const secretHeaders: Record<string, string> = {};

        if (persistedConfig.env) {
          const safeEnv: Record<string, string> = {};
          for (const [k, v] of Object.entries(persistedConfig.env)) {
            if (/token|key|secret|password|auth|credential/i.test(k) && v !== '[SECURE_STORE]') {
              secretEnv[k] = v;
              safeEnv[k] = '[SECURE_STORE]';
            } else {
              safeEnv[k] = v;
            }
          }
          persistedConfig.env = safeEnv;
        }

        if (persistedConfig.headers) {
          const safeHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(persistedConfig.headers)) {
            if (/auth|token|key|secret|cookie/i.test(k) && v !== '[SECURE_STORE]') {
              secretHeaders[k] = v;
              safeHeaders[k] = '[SECURE_STORE]';
            } else {
              safeHeaders[k] = v;
            }
          }
          persistedConfig.headers = safeHeaders;
        }

        // Store sensitive secrets in OS secure storage
        if (Object.keys(secretEnv).length > 0 || Object.keys(secretHeaders).length > 0) {
          try {
            await this.credentialStore.save(`mcp_${rawConfig.id}`, {
              provider: 'mcp',
              updatedAt: new Date().toISOString(),
              extraData: { env: secretEnv, headers: secretHeaders },
            });
          } catch {
            // Ignore secure storage errors in restricted test environments
          }
        }

        configsToPersist.push(persistedConfig);
      }

      await writeFile(this.storagePath, JSON.stringify(configsToPersist, null, 2), 'utf-8');
    } catch {
      // Ignore write errors in restricted test environments
    }
  }

  /**
   * Add a new MCP server configuration.
   */
  async addServer(config: McpServerConfig): Promise<McpServerState> {
    if (!config.id || !/^[a-zA-Z0-9_-]+$/.test(config.id)) {
      throw new Error(
        `Invalid server ID: "${config.id}". Must contain only alphanumeric characters, dashes, and underscores.`,
      );
    }

    if (this.clients.has(config.id)) {
      throw new Error(`MCP server with ID "${config.id}" already exists`);
    }

    const client = this.createClient(config);
    this.clients.set(config.id, client);
    await this.persistConfiguredServers();

    if (config.autoConnect) {
      try {
        await client.connect();
      } catch {
        // connect error recorded in state
      }
    }

    return client.getState();
  }

  /**
   * Register an existing or mock McpClient directly (useful for tests and in-process integrations).
   */
  registerClient(client: McpClient): void {
    this.clients.set(client.config.id, client);
  }

  /**
   * Remove an MCP server and disconnect if running.
   */
  async removeServer(id: string): Promise<boolean> {
    const client = this.clients.get(id);
    if (!client) return false;

    await client.disconnect();
    this.clients.delete(id);
    await this.persistConfiguredServers();
    await this.credentialStore.delete(`mcp_${id}`).catch(() => {});
    return true;
  }

  /**
   * Connect to an existing configured MCP server.
   */
  async connectServer(id: string): Promise<McpServerState> {
    const client = this.clients.get(id);
    if (!client) {
      throw new Error(`MCP server "${id}" not found`);
    }

    await client.connect();
    return client.getState();
  }

  /**
   * Disconnect an MCP server.
   */
  async disconnectServer(id: string): Promise<McpServerState> {
    const client = this.clients.get(id);
    if (!client) {
      throw new Error(`MCP server "${id}" not found`);
    }

    await client.disconnect();
    return client.getState();
  }

  /**
   * Ping / test health of an MCP server.
   */
  async pingServer(id: string): Promise<boolean> {
    const client = this.clients.get(id);
    if (!client) return false;
    return client.ping();
  }

  /**
   * Retrieve state for a specific server.
   */
  getServer(id: string): McpServerState | undefined {
    return this.clients.get(id)?.getState();
  }

  /**
   * List all configured servers and their states.
   */
  listServers(): McpServerState[] {
    return Array.from(this.clients.values()).map(c => c.getState());
  }

  /**
   * Find a tool across all connected MCP servers by compound name `server:tool` or serverId + toolName.
   */
  findTool(
    serverId: string,
    toolName: string,
  ): { client: McpClient; tool: McpDiscoveredTool } | undefined {
    const client = this.clients.get(serverId);
    if (!client) return undefined;

    const state = client.getState();
    const tool = state.tools.find(t => t.name === toolName);
    if (!tool) return undefined;

    return { client, tool };
  }

  /**
   * Safely invoke an approved tool on an MCP server with schema validation and permission enforcement.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown> = {},
    confirmed = false,
  ): Promise<CallToolResult> {
    const match = this.findTool(serverId, toolName);
    if (!match) {
      throw new Error(`Tool "${toolName}" on server "${serverId}" not found or server is not connected`);
    }

    const { client, tool } = match;

    // 1. Validate inputs against discovered schema
    this.validateInputs(tool.inputSchema, args);

    // 2. Check permission policy with exact input payload
    let permResult = this.checkToolPermission(serverId, tool, args);
    if (!permResult.allowed) {
      if (confirmed) {
        // Record an approval decision bound strictly to this exact server, tool, and input payload
        this.permissions.recordApproval(
          `mcp:${serverId}`,
          tool.name,
          tool.permissionLevel,
          'user',
          'Explicit user confirmation',
          args,
        );
        permResult = this.checkToolPermission(serverId, tool, args);
      }

      if (!permResult.allowed) {
        return {
          status: 'blocked',
          serverId,
          toolName,
          permission: permResult,
          error: `Action blocked: ${permResult.reason}`,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // 3. Execute tool safely
    try {
      const output = await client.callTool(toolName, args);
      return {
        status: 'success',
        serverId,
        toolName,
        output: output as any,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        status: 'error',
        serverId,
        toolName,
        error: (err as Error).message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Cleanly disconnect all running servers (e.g. on shutdown).
   */
  async closeAll(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.disconnect();
      } catch {
        // ignore shutdown errors
      }
    }
  }

  /**
   * Alias for closeAll() to disconnect all servers.
   */
  async disconnectAll(): Promise<void> {
    await this.closeAll();
  }

  /**
   * Alias for getServer().
   */
  getServerState(id: string): McpServerState | undefined {
    return this.getServer(id);
  }

  /**
   * Health check / ping test with discovered tool count.
   */
  async testServer(id: string): Promise<{ success: boolean; toolCount: number; error?: string }> {
    const client = this.clients.get(id);
    if (!client) {
      return { success: false, toolCount: 0, error: `MCP server "${id}" not found` };
    }
    try {
      const alive = await client.ping();
      const state = client.getState();
      return { success: alive, toolCount: state.tools.length };
    } catch (err) {
      return { success: false, toolCount: 0, error: (err as Error).message };
    }
  }

  private createClient(config: McpServerConfig): McpClient {
    if (config.transport === 'stdio') {
      return new StdioMcpClient(config);
    } else if (config.transport === 'http') {
      return new HttpMcpClient(config);
    } else {
      throw new Error(`Unsupported MCP transport: "${(config as any).transport}"`);
    }
  }

  /**
   * Comprehensive, recursive JSON schema validation.
   * Handles nested objects, arrays, enums, additionalProperties, and primitive types.
   */
  private validateSchema(
    schema: Record<string, unknown> | undefined,
    value: unknown,
    path = '',
  ): void {
    if (!schema || typeof schema !== 'object') return;

    // Type validation
    if (schema.type && value !== undefined && value !== null) {
      const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actualType = Array.isArray(value) ? 'array' : typeof value;

      const typeMatches = expectedTypes.some(expected => {
        if (expected === 'integer' && typeof value === 'number' && Number.isInteger(value)) return true;
        if (expected === 'number' && typeof value === 'number') return true;
        if (expected === actualType) return true;
        return false;
      });

      if (!typeMatches) {
        const fieldName = path || 'argument';
        throw new Error(
          `Invalid type for argument "${fieldName}": expected ${expectedTypes.join(' | ')}, received ${actualType}`,
        );
      }
    }

    // Enum validation
    if (Array.isArray(schema.enum) && value !== undefined && value !== null) {
      const match = schema.enum.some(allowed => JSON.stringify(allowed) === JSON.stringify(value));
      if (!match) {
        const fieldName = path || 'argument';
        throw new Error(
          `Invalid value for argument "${fieldName}": value is not in allowed enum [${schema.enum.map(e => JSON.stringify(e)).join(', ')}]`,
        );
      }
    }

    // Object validation
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;

      // Required properties
      if (Array.isArray(schema.required)) {
        for (const reqKey of schema.required) {
          if (typeof reqKey === 'string' && (obj[reqKey] === undefined || obj[reqKey] === null)) {
            const fullKey = path ? `${path}.${reqKey}` : reqKey;
            throw new Error(`Missing required parameter: "${fullKey}"`);
          }
        }
      }

      const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;

      // Additional properties check
      if (schema.additionalProperties === false) {
        for (const propKey of Object.keys(obj)) {
          if (!properties[propKey]) {
            const fullKey = path ? `${path}.${propKey}` : propKey;
            throw new Error(`Unexpected additional property: "${fullKey}" is not permitted`);
          }
        }
      }

      // Validate each defined property
      for (const [propKey, propSpec] of Object.entries(properties)) {
        if (obj[propKey] !== undefined) {
          const subPath = path ? `${path}.${propKey}` : propKey;
          this.validateSchema(propSpec, obj[propKey], subPath);
        }
      }
    }

    // Array validation
    if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
      const itemSchema = schema.items as Record<string, unknown>;
      for (let i = 0; i < value.length; i++) {
        this.validateSchema(itemSchema, value[i], `${path}[${i}]`);
      }
    }
  }

  validateInputs(schema: Record<string, unknown> | undefined, args: Record<string, unknown>): void {
    if (!schema) return;
    this.validateSchema(schema, args, '');
  }

  checkToolPermission(
    serverId: string,
    tool: McpDiscoveredTool,
    inputs: Record<string, unknown>,
  ): PermissionCheckResult {
    // Read operations are allowed without prior approval
    if (tool.permissionLevel === 'read') {
      return {
        allowed: true,
        requiresApproval: false,
        level: 'read',
        reason: 'Read operation allowed by default',
      };
    }

    // Local writes are allowed if requiresApproval is false
    if (tool.permissionLevel === 'local-write' && !tool.requiresApproval) {
      return {
        allowed: true,
        requiresApproval: false,
        level: 'local-write',
        reason: 'Local write allowed by policy',
      };
    }

    // Check if permission manager has an approval record for this bridge/server + tool
    // Synthesize a bridge manifest representation for the permission manager
    const syntheticManifest = {
      schema: '1.0' as const,
      name: `mcp:${serverId}`,
      displayName: `MCP Server (${serverId})`,
      description: 'External MCP Server',
      version: '1.0.0',
      capabilities: [
        {
          action: tool.name,
          description: tool.description || '',
          permissionLevel: tool.permissionLevel,
          sideEffects: true,
        },
      ],
      integrations: [],
      auth: [],
      permissions: [
        {
          actions: tool.name,
          level: tool.permissionLevel,
          requiresApproval: tool.requiresApproval,
        },
      ],
    };

    return this.permissions.checkPermission(syntheticManifest, tool.name, inputs);
  }
}
