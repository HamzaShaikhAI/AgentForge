import { PermissionLevel } from '../types.js';

export type McpTransportType = 'stdio' | 'http';

export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpServerConfig {
  /** Unique server identifier (alphanumeric and dashes) */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Description of what this MCP server provides */
  description?: string;
  /** Transport protocol */
  transport: McpTransportType;
  /** Executable command (for stdio transport) */
  command?: string;
  /** Command line arguments (for stdio transport) */
  args?: string[];
  /** Environment variables (for stdio transport, secrets will be redacted in views) */
  env?: Record<string, string>;
  /** Remote endpoint URL (for http transport) */
  url?: string;
  /** Custom HTTP request headers (for http transport) */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default 15000) */
  timeoutMs?: number;
  /** Whether to connect automatically on startup */
  autoConnect?: boolean;
}

export interface McpDiscoveredTool {
  /** Original tool name as exposed by the MCP server */
  name: string;
  /** Discovered description */
  description?: string;
  /** JSON Schema for input parameters */
  inputSchema?: Record<string, unknown>;
  /** Inferred or assigned AgentForge permission level */
  permissionLevel: PermissionLevel;
  /** Whether explicit user approval is required before execution */
  requiresApproval: boolean;
  /** Whether this action causes side effects */
  sideEffects?: boolean;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpServerState {
  id: string;
  name: string;
  description?: string;
  transport: McpTransportType;
  status: McpServerStatus;
  error?: string;
  connectedAt?: string;
  serverInfo?: McpServerInfo;
  tools: McpDiscoveredTool[];
  config: McpServerConfig;
  env?: Record<string, string>;
  command?: string;
  url?: string;
}

export interface McpClient {
  readonly id: string;
  readonly config: McpServerConfig;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpDiscoveredTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  ping(): Promise<boolean>;
  getStatus(): McpServerStatus;
  getState(): McpServerState;
}

/**
 * Infer permission level from tool name and description.
 * Defaults to least-privilege, marking consequential actions as requiring approval.
 */
export function inferToolPermission(name: string, description = ''): { level: PermissionLevel; requiresApproval: boolean } {
  const text = `${name} ${description}`.toLowerCase();

  // Destructive operations (drop, delete, remove, purge, destroy, terminate)
  if (/\b(delete|remove|destroy|drop|purge|truncate|terminate|kill|revoke)\b/.test(text)) {
    return { level: 'destructive', requiresApproval: true };
  }

  // Publishing operations (publish, release, deploy, upload)
  if (/\b(publish|release|deploy|upload|distribute)\b/.test(text)) {
    return { level: 'publish', requiresApproval: true };
  }

  // External write operations (push, send, post, patch, put, update, modify, invite, submit)
  if (/\b(push|send|post|patch|update|modify|submit|broadcast|invite|email|tweet|comment)\b/.test(text)) {
    return { level: 'external-write', requiresApproval: true };
  }

  // Local write operations (create, write, set, make, build, touch, edit)
  if (/\b(create|write|set|save|add|insert|make|build|touch|edit)\b/.test(text)) {
    return { level: 'local-write', requiresApproval: false };
  }

  // Safe read operations (read, get, list, search, view, inspect, fetch, find, ping, etc.)
  if (/\b(read|get|list|search|view|inspect|fetch|find|ping|check|query|show|describe|status|count|diff|log|info|cat|preview)\b/.test(text)) {
    return { level: 'read', requiresApproval: false };
  }

  // Default for unrecognized or ambiguous tools: conservative least-privilege (require approval)
  return { level: 'external-write', requiresApproval: true };
}
