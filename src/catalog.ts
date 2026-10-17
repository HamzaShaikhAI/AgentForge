import { BridgeRegistry } from './bridge-registry.js';
import { McpManager } from './mcp/mcp-manager.js';
import { GitExecutor } from './executors/git-executor.js';
import { GoogleOAuthService } from './auth/google-oauth.js';
import { CapabilityTruthEngine } from './truth/index.js';
import {
  McpPreset,
  getCuratedPresets,
  getPresetById,
  searchPresets,
  presetToMcpConfig,
} from './mcp/presets.js';
import { McpServerState } from './mcp/types.js';

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
    curatedPresets: number;
    totalDeclaredCapabilities: number;
    totalExecutableCapabilities: number;
  };
  metrics?: {
    totalIntegrations: number;
    builtInBridges: number;
    customBridges: number;
    externalMcpServers: number;
    curatedPresets: number;
    totalDeclaredCapabilities: number;
    totalExecutableTools: number;
  };
  items: CatalogItem[];
  presets: McpPreset[];
  timestamp: string;
}

const BUILTIN_BRIDGE_NAMES = new Set(['github', 'example', 'example-echo', 'youtube']);

export class IntegrationCatalog {
  private truthEngine: CapabilityTruthEngine;

  constructor(
    private registry: BridgeRegistry,
    private mcpManager: McpManager,
    private gitExecutor = new GitExecutor(),
    private googleOAuth = new GoogleOAuthService(),
    truthEngine?: CapabilityTruthEngine,
  ) {
    this.truthEngine = truthEngine || new CapabilityTruthEngine(this.registry, this.gitExecutor, this.googleOAuth, this.mcpManager);
  }

  getTruthEngine(): CapabilityTruthEngine {
    return this.truthEngine;
  }

  async getCatalog(): Promise<UnifiedCatalog> {
    await this.registry.discover();

    let gitOk = false;
    try {
      gitOk = await this.gitExecutor.isGitInstalled();
    } catch {
      gitOk = false;
    }

    let googleStatus: { accountConnected: boolean; grantedScopes: string[]; clientConfigured: boolean; connectedAccount?: string | null } = {
      accountConnected: false,
      grantedScopes: [],
      clientConfigured: false,
      connectedAccount: null,
    };
    try {
      googleStatus = await this.googleOAuth.getStatus();
    } catch {
      // unconfigured
    }

    const items: CatalogItem[] = [];

    // 1. Process Bridges
    for (const entry of this.registry.list()) {
      const m = entry.manifest;
      const isBuiltin = BUILTIN_BRIDGE_NAMES.has(m.name);
      const type: CatalogItem['type'] = isBuiltin ? 'builtin-bridge' : 'custom-bridge';

      const declared: CatalogCapability[] = [];
      const executable: CatalogCapability[] = [];

      for (const cap of m.capabilities) {
        const truth = await this.truthEngine.getCapabilityTruth(m.name, cap.action);

        const capItem: CatalogCapability = {
          name: cap.action,
          description: cap.description,
          permissionLevel: cap.permissionLevel,
          requiresApproval: truth.requiresApproval,
          executable: truth.isExecutable,
          reason: truth.blockerReason,
          inputSchema: {
            type: 'object',
            properties: (cap.inputs || []).reduce((acc, field) => {
              acc[field.name] = { type: field.type, description: field.description };
              return acc;
            }, {} as Record<string, unknown>),
          },
        };

        declared.push(capItem);
        if (truth.isExecutable) {
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

    const presets = getCuratedPresets();

    return {
      summary: {
        totalIntegrations: items.length,
        builtinBridges,
        customBridges,
        externalMcpServers,
        curatedPresets: presets.length,
        totalDeclaredCapabilities,
        totalExecutableCapabilities,
      },
      metrics: {
        totalIntegrations: items.length,
        builtInBridges: builtinBridges,
        customBridges,
        externalMcpServers,
        curatedPresets: presets.length,
        totalDeclaredCapabilities,
        totalExecutableTools: totalExecutableCapabilities,
      },
      items,
      presets,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Search or list curated MCP presets.
   */
  getPresets(query?: string, category?: string): McpPreset[] {
    return searchPresets(query, category);
  }

  /**
   * Find a single preset by ID.
   */
  getPreset(id: string): McpPreset | undefined {
    return getPresetById(id);
  }

  /**
   * Install and configure a curated MCP preset.
   */
  async installPreset(
    presetId: string,
    options?: { env?: Record<string, string>; customArgs?: string[] },
  ): Promise<McpServerState> {
    const preset = getPresetById(presetId);
    if (!preset) {
      throw new Error(`Curated MCP preset "${presetId}" not found in catalog.`);
    }
    const config = presetToMcpConfig(preset, options);
    return this.mcpManager.addServer(config);
  }
}
