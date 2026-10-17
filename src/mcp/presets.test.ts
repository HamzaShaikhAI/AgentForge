import { describe, it, expect } from 'vitest';
import {
  CURATED_MCP_PRESETS,
  getCuratedPresets,
  getPresetById,
  searchPresets,
  presetToMcpConfig,
} from './presets.js';

describe('Universal MCP Catalog Presets (Phase 3)', () => {
  it('contains at least 50 distinct, verified MCP server presets', () => {
    const presets = getCuratedPresets();
    expect(presets.length).toBeGreaterThanOrEqual(50);
  });

  it('ensures all preset IDs are unique kebab-case strings', () => {
    const ids = new Set<string>();
    for (const preset of CURATED_MCP_PRESETS) {
      expect(preset.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
    }
  });

  it('verifies that every preset has complete metadata (docs, repo, license, sample tools)', () => {
    const validTransports = new Set(['stdio', 'http']);
    const validPerms = new Set(['read', 'local-write', 'external-write', 'publish', 'destructive']);

    for (const preset of CURATED_MCP_PRESETS) {
      expect(preset.displayName.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(10);
      expect(preset.officialDocs).toMatch(/^https?:\/\//);
      expect(preset.repository).toMatch(/^https?:\/\//);
      expect(preset.license.length).toBeGreaterThan(0);
      expect(validTransports.has(preset.transport)).toBe(true);
      expect(preset.command.length).toBeGreaterThan(0);
      expect(Array.isArray(preset.args)).toBe(true);
      expect(preset.sampleTools.length).toBeGreaterThanOrEqual(1);

      for (const tool of preset.sampleTools) {
        expect(tool.name.length).toBeGreaterThan(0);
        expect(tool.description.length).toBeGreaterThan(0);
        expect(validPerms.has(tool.permissionLevel)).toBe(true);
        expect(typeof tool.requiresApproval).toBe('boolean');
      }
    }
  });

  it('supports searching presets across query keywords and categories', () => {
    const gitPresets = searchPresets('git', 'source-control');
    expect(gitPresets.length).toBeGreaterThanOrEqual(2);
    expect(gitPresets.some(p => p.id === 'git')).toBe(true);
    expect(gitPresets.some(p => p.id === 'github')).toBe(true);

    const dbPresets = searchPresets('', 'database');
    expect(dbPresets.length).toBeGreaterThanOrEqual(5);

    const searchResult = searchPresets('postgres');
    expect(searchResult.some(p => p.id === 'postgres')).toBe(true);
  });

  it('correctly converts preset to McpServerConfig with user environment overrides', () => {
    const pg = getPresetById('postgres');
    expect(pg).toBeDefined();

    const config = presetToMcpConfig(pg!, {
      env: { POSTGRES_CONNECTION_STRING: 'postgresql://localhost:5432/test' },
      customArgs: ['--debug'],
    });

    expect(config.id).toBe('postgres');
    expect(config.transport).toBe('stdio');
    expect(config.env.POSTGRES_CONNECTION_STRING).toBe('postgresql://localhost:5432/test');
    expect(config.args).toContain('--debug');
  });
});
