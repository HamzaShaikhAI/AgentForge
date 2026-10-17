import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, rmSync } from 'node:fs';
import { BridgeRegistry } from './bridge-registry.js';
import { McpManager } from './mcp/mcp-manager.js';
import { IntegrationCatalog } from './catalog.js';

describe('IntegrationCatalog (Unified Integration Catalog)', () => {
  const root = resolve(import.meta.dirname, '..');
  const bridgesDir = join(root, 'bridges');
  let tempStoragePath: string;
  let registry: BridgeRegistry;
  let mcpManager: McpManager;
  let catalog: IntegrationCatalog;

  beforeEach(() => {
    tempStoragePath = join(tmpdir(), `test-catalog-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    registry = new BridgeRegistry(bridgesDir);
    mcpManager = new McpManager(tempStoragePath);
    catalog = new IntegrationCatalog(registry, mcpManager);
  });

  afterEach(async () => {
    await mcpManager.disconnectAll();
    if (existsSync(tempStoragePath)) {
      try {
        rmSync(tempStoragePath);
      } catch {
        // ignore
      }
    }
  });

  it('generates unified catalog with built-in bridges', async () => {
    const data = await catalog.getCatalog();

    expect(data.summary).toBeDefined();
    expect(data.summary.builtinBridges).toBeGreaterThanOrEqual(2);
    expect(data.summary.totalIntegrations).toBeGreaterThanOrEqual(2);
    expect(data.summary.totalDeclaredCapabilities).toBeGreaterThan(0);
    expect(data.summary.totalExecutableCapabilities).toBeGreaterThan(0);

    const github = data.items.find(i => i.name === 'github');
    expect(github).toBeDefined();
    expect(github?.type).toBe('builtin-bridge');
    expect(github?.status).toBe('available');
    expect(github?.declaredCapabilities.length).toBeGreaterThan(0);
    expect(github?.verifiedExecutableCapabilities.length).toBeGreaterThan(0);

    const echo = data.items.find(i => i.name === 'example-echo');
    expect(echo).toBeDefined();
    expect(echo?.type).toBe('builtin-bridge');

    const youtube = data.items.find(i => i.name === 'youtube');
    expect(youtube).toBeDefined();
    expect(youtube?.type).toBe('builtin-bridge');
    expect(youtube?.declaredCapabilities.length).toBe(4);
    expect(youtube?.declaredCapabilities.some(c => c.name === 'channel-inspect')).toBe(true);
    expect(youtube?.declaredCapabilities.some(c => c.name === 'channel-metadata')).toBe(true);
    expect(youtube?.declaredCapabilities.some(c => c.name === 'video-list')).toBe(true);
    expect(youtube?.declaredCapabilities.some(c => c.name === 'video-upload')).toBe(true);
  });

  it('integrates external MCP servers and distinguishes declared from executable tools', async () => {
    // Add disconnected external MCP server with configured tools
    await mcpManager.addServer({
      id: 'custom-mcp-service',
      name: 'Custom Service',
      description: 'External MCP service description',
      transport: 'stdio',
      command: 'node',
      args: ['dummy.js'],
      autoConnect: false,
    });

    const dataDisconnected = await catalog.getCatalog();
    expect(dataDisconnected.summary.externalMcpServers).toBe(1);

    const mcpItem = dataDisconnected.items.find(i => i.id === 'mcp:custom-mcp-service');
    expect(mcpItem).toBeDefined();
    expect(mcpItem?.type).toBe('external-mcp');
    expect(mcpItem?.status).toBe('disconnected');
    // When disconnected and no tools discovered, executable capabilities is 0
    expect(mcpItem?.verifiedExecutableCapabilities.length).toBe(0);
  });

  it('includes curated universal MCP presets and supports search and installation', async () => {
    const data = await catalog.getCatalog();
    expect(data.presets).toBeDefined();
    expect(data.presets.length).toBeGreaterThanOrEqual(8);
    expect(data.summary.curatedPresets).toBe(data.presets.length);

    // Verify key presets exist
    const fsPreset = catalog.getPreset('filesystem');
    expect(fsPreset).toBeDefined();
    expect(fsPreset?.license).toBe('MIT');
    expect(fsPreset?.category).toBe('filesystem');

    const ghPreset = catalog.getPreset('github');
    expect(ghPreset?.authMethod).toBe('env-token');
    expect(ghPreset?.requiredEnvVars).toContain('GITHUB_PERSONAL_ACCESS_TOKEN');

    // Search by category
    const dbPresets = catalog.getPresets(undefined, 'database');
    expect(dbPresets.length).toBeGreaterThanOrEqual(2);
    expect(dbPresets.some(p => p.id === 'sqlite')).toBe(true);
    expect(dbPresets.some(p => p.id === 'postgres')).toBe(true);

    // Install a curated preset
    const installed = await catalog.installPreset('web-fetch');
    expect(installed.id).toBe('web-fetch');
    expect(installed.status).toBe('disconnected');

    const updatedData = await catalog.getCatalog();
    expect(updatedData.items.some(i => i.id === 'mcp:web-fetch')).toBe(true);
  });
});
