import { describe, it, expect, beforeEach } from 'vitest';
import { BridgeRegistry } from './bridge-registry.js';
import { BridgeManifest } from './types.js';
import { resolve } from 'node:path';

const validManifest: BridgeManifest = {
  schema: '1.0',
  name: 'test-bridge',
  displayName: 'Test Bridge',
  description: 'A test bridge',
  version: '1.0.0',
  category: 'development',
  capabilities: [
    { action: 'test', description: 'Test', permissionLevel: 'read', sideEffects: false },
  ],
  integrations: [],
  auth: [],
  permissions: [
    { actions: 'test', level: 'read', requiresApproval: false },
  ],
  tags: ['test'],
};

describe('BridgeRegistry', () => {
  let registry: BridgeRegistry;

  beforeEach(() => {
    registry = new BridgeRegistry('c:/tmp/test-bridges');
  });

  it('registers a valid manifest', () => {
    const result = registry.register(validManifest, 'test.json');
    expect(result.valid).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects an invalid manifest', () => {
    const result = registry.register({ schema: 'bad' } as any, 'bad.json');
    expect(result.valid).toBe(false);
    expect(registry.list()).toHaveLength(0);
  });

  it('gets a bridge by name', () => {
    registry.register(validManifest, 'test.json');
    const entry = registry.get('test-bridge');
    expect(entry).toBeDefined();
    expect(entry!.manifest.name).toBe('test-bridge');
  });

  it('returns undefined for missing bridge', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists bridges by category', () => {
    registry.register(validManifest, 'test.json');
    expect(registry.listByCategory('development')).toHaveLength(1);
    expect(registry.listByCategory('media')).toHaveLength(0);
  });

  it('searches bridges by query', () => {
    registry.register(validManifest, 'test.json');
    expect(registry.search('test')).toHaveLength(1);
    expect(registry.search('nonexistent')).toHaveLength(0);
  });

  it('enables and disables bridges', () => {
    registry.register(validManifest, 'test.json');
    expect(registry.get('test-bridge')!.enabled).toBe(true);
    registry.setEnabled('test-bridge', false);
    expect(registry.get('test-bridge')!.enabled).toBe(false);
  });

  it('unregisters bridges', () => {
    registry.register(validManifest, 'test.json');
    expect(registry.unregister('test-bridge')).toBe(true);
    expect(registry.list()).toHaveLength(0);
    expect(registry.unregister('test-bridge')).toBe(false);
  });

  it('discovers bridges from the actual bridges directory', async () => {
    const bridgesDir = resolve(process.cwd(), 'bridges');
    const fsRegistry = new BridgeRegistry(bridgesDir);
    const result = await fsRegistry.discover();
    expect(result.loaded.length).toBeGreaterThanOrEqual(2);
    expect(result.loaded).toContain('github');
    expect(result.loaded).toContain('example-echo');
    expect(result.errors).toHaveLength(0);
  });
});
