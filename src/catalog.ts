import { BridgeRegistry } from './bridge-registry.js';
import { McpManager } from './mcp/mcp-manager.js';
import { GitExecutor } from './executors/git-executor.js';
import { GoogleOAuthService } from './auth/google-oauth.js';

export interface CatalogCapability {
  name: string;
  description: string;
  permissionLevel: string;
  requiresApproval: boolean;
  executable: boolean;
  reason?: string;
  inputSchema?: Record<string, unknown>;
}

export interface CatalogItem {
  id: string;
  name: string;
  displayName: string;
  type: 'builtin-bridge' | 'custom-bridge' | 'external-mcp';
  description: string;
  version?: string;
  status: 'available' | 'configured' | 'unconfigured' | 'connected' | 'connecting' | 'disconnected' | 'error';
  authStatus?: string;
  declaredCapabilities: CatalogCapability[];
  verifiedExecutableCapabilities: CatalogCapability[];
}

export interface UnifiedCatalog {
  summary: {
    totalIntegrations: number;
    builtinBridges: number;
    customBridges: number;
    externalMcpServers: number;
    totalDeclaredCapabilities: number;
    totalExecutableCapabilities: number;
  };
  items: CatalogItem[];
  timestamp: string;
}

const BUILTIN_BRIDGE_NAMES = new Set(['github', 'example', 'example-echo', 'youtube']);

export class IntegrationCatalog {
  constructor(
    private registry: BridgeRegistry,
    private mcpManager: McpManager,
    private gitExecutor = new GitExecutor(),
    private googleOAuth = new GoogleOAuthService(),
  ) {}

  async getCatalog(): Promise<UnifiedCatalog> {
    await this.registry.discover();

    // Check Git availability
    let gitOk = false;
    try {
      await this.gitExecutor.runGit(['--version']);
      gitOk = true;
    } catch {
      // not available
    }

    const googleStatus = await this.googleOAuth.getStatus();
    const items: CatalogItem[] = [];

    // 1. Process Bridges
    for (const entry of this.registry.list()) {
      const m = entry.manifest;
      const isBuiltin = BUILTIN_BRIDGE_NAMES.has(m.name);
      const type: CatalogItem['type'] = isBuiltin ? 'builtin-bridge' : 'custom-bridge';

      const declared: CatalogCapability[] = [];
      const executable: CatalogCapability[] = [];

      for (const cap of m.capabilities) {
        let isCapExecutable = false;
        let blockerReason: string | undefined;

        if (m.name === 'github') {
          const gitSupportedActions = new Set([
            'repo-info',
            'status-check',
            'branch-list',
            'log-inspect',
            'diff-review',
            'release-verify',
          ]);

          if (!gitSupportedActions.has(cap.action)) {
            isCapExecutable = false;
            blockerReason = `Action "${cap.action}" is declared in manifest but has no runtime executor implementation`;
          } else if (!gitOk) {
            isCapExecutable = false;
            blockerReason = 'Local git CLI executable is not installed on system PATH';
          } else {
            isCapExecutable = true;
          }
        } else if (m.name === 'youtube') {
          const ytSupportedActions = new Set([
            'channel-inspect',
            'channel-metadata',
            'video-list',
            'video-upload',
          ]);

          if (!ytSupportedActions.has(cap.action)) {
            isCapExecutable = false;
            blockerReason = `Action "${cap.action}" is declared in manifest but has no runtime executor implementation`;
          } else if (!googleStatus.accountConnected) {
            isCapExecutable = false;
            blockerReason = 'Google account is not connected. Run "agentforge auth youtube" to connect.';
          } else if (cap.action === 'video-upload') {
            if (!googleStatus.grantedScopes.includes('https://www.googleapis.com/auth/youtube.upload')) {
              isCapExecutable = false;
              blockerReason = 'YouTube upload permission has not been granted. Run "agentforge auth youtube --upload" to authorize video publishing.';
            } else {
              isCapExecutable = true;
            }
          } else if (!googleStatus.grantedScopes.includes('https://www.googleapis.com/auth/youtube.readonly')) {
            isCapExecutable = false;
            blockerReason = 'YouTube read-only permission has not been granted. Run "agentforge auth youtube" to authorize.';
          } else {
            isCapExecutable = true;
          }
        } else if (m.name === 'example' || m.name === 'example-echo') {
          isCapExecutable = true;
        } else {
          // Custom user bridges
          isCapExecutable = entry.enabled;
        }

        const capItem: CatalogCapability = {
          name: cap.action,
          description: cap.description,
          permissionLevel: cap.permissionLevel,
          requiresApproval: cap.permissionLevel !== 'read' && cap.permissionLevel !== 'local-write',
          executable: isCapExecutable,
          reason: blockerReason,
          inputSchema: {
            type: 'object',
            properties: (cap.inputs || []).reduce((acc, field) => {
              acc[field.name] = { type: field.type, description: field.description };
              return acc;
            }, {} as Record<string, unknown>),
          },
        };

        declared.push(capItem);
        if (isCapExecutable) {
          executable.push(capItem);
        }
      }

      let status: CatalogItem['status'] = 'available';
      let authStatus = 'Local system tools';
      if (m.name === 'github') {
        status = gitOk ? 'available' : 'unconfigured';
        authStatus = process.env.GITHUB_TOKEN ? 'Authenticated via GITHUB_TOKEN' : 'Public / Local Git only';
      } else if (m.name === 'youtube') {
        const hasScope = googleStatus.grantedScopes.includes('https://www.googleapis.com/auth/youtube.readonly');
        if (googleStatus.accountConnected && hasScope) {
          status = 'connected';
          authStatus = `Connected via Google OAuth (${googleStatus.connectedAccount || 'authorized'})`;
        } else if (googleStatus.accountConnected) {
          status = 'configured';
          authStatus = 'Connected to Google, but YouTube scope is missing';
        } else if (googleStatus.clientConfigured) {
          status = 'configured';
          authStatus = 'OAuth client configured; authorization required';
        } else {
          status = 'unconfigured';
          authStatus = 'OAuth client unconfigured';
        }
      }

      items.push({
        id: `bridge:${m.name}`,
        name: m.name,
        displayName: m.displayName,
        type,
        description: m.description,
        version: m.version,
        status,
        authStatus,
        declaredCapabilities: declared,
        verifiedExecutableCapabilities: executable,
      });
    }

    // 2. Process External MCP Servers
    const mcpServers = this.mcpManager.listServers();
    for (const s of mcpServers) {
      const isConnected = s.status === 'connected';
      const declared: CatalogCapability[] = [];
      const executable: CatalogCapability[] = [];

      for (const tool of s.tools) {
        const capItem: CatalogCapability = {
          name: tool.name,
          description: tool.description || '',
          permissionLevel: tool.permissionLevel,
          requiresApproval: tool.requiresApproval,
          executable: isConnected,
          reason: isConnected ? undefined : `MCP server is ${s.status}`,
          inputSchema: tool.inputSchema,
        };

        declared.push(capItem);
        if (isConnected) {
          executable.push(capItem);
        }
      }

      items.push({
        id: `mcp:${s.id}`,
        name: s.id,
        displayName: s.name,
        type: 'external-mcp',
        description: s.description || `External MCP Server (${s.transport})`,
        version: s.serverInfo?.version,
        status: s.status,
        authStatus: s.transport === 'http' ? 'Remote HTTP Endpoint' : 'Local Stdio Child Process',
        declaredCapabilities: declared,
        verifiedExecutableCapabilities: executable,
      });
    }

    // Summary calculation
    const builtinBridges = items.filter(i => i.type === 'builtin-bridge').length;
    const customBridges = items.filter(i => i.type === 'custom-bridge').length;
    const externalMcpServers = items.filter(i => i.type === 'external-mcp').length;
    const totalDeclaredCapabilities = items.reduce((acc, i) => acc + i.declaredCapabilities.length, 0);
    const totalExecutableCapabilities = items.reduce((acc, i) => acc + i.verifiedExecutableCapabilities.length, 0);

    return {
      summary: {
        totalIntegrations: items.length,
        builtinBridges,
        customBridges,
        externalMcpServers,
        totalDeclaredCapabilities,
        totalExecutableCapabilities,
      },
      items,
      timestamp: new Date().toISOString(),
    };
  }
}
