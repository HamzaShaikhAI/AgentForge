import { describe, it, expect, beforeEach } from 'vitest';
import { Context7Adapter } from './context7.js';

describe('Context7Adapter', () => {
  let adapter: Context7Adapter;

  beforeEach(() => {
    adapter = new Context7Adapter();
  });

  it('exposes correct metadata and category', () => {
    expect(adapter.name).toBe('context7');
    expect(adapter.displayName).toBe('Context7 Documentation Hub');
    expect(adapter.category).toBe('developer-tools');
    expect(adapter.version).toBe('1.0.0');
  });

  it('queries live documentation and prevents hallucinations', async () => {
    const res = await adapter.execute('query-docs', {
      library: 'react',
      query: 'useActionState',
      version: '19.0.0',
    }) as any;

    expect(res.success).toBe(true);
    expect(res.library).toBe('react');
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].deprecated).toBe(false);
  });

  it('fetches package specifications from registry', async () => {
    const res = await adapter.execute('fetch-package-spec', {
      package: '@tanstack/react-query',
      ecosystem: 'npm',
    }) as any;

    expect(res.success).toBe(true);
    expect(res.package).toBe('@tanstack/react-query');
    expect(res.exports).toContain('.');
  });

  it('verifies API syntax accurately', async () => {
    const res = await adapter.execute('verify-api-syntax', {
      library: 'zod',
      method: 'z.object',
    }) as any;

    expect(res.success).toBe(true);
    expect(res.valid).toBe(true);
    expect(res.hallucinated).toBe(false);
  });

  it('retrieves code examples and diffs versions', async () => {
    const exRes = await adapter.execute('get-code-examples', {
      library: 'next',
      pattern: 'AppRouterClient',
    }) as any;
    expect(exRes.success).toBe(true);
    expect(exRes.code).toContain('import');

    const diffRes = await adapter.execute('diff-library-versions', {
      library: 'tailwindcss',
      fromVersion: '3.4',
      toVersion: '4.0',
    }) as any;
    expect(diffRes.success).toBe(true);
    expect(diffRes.breakingChanges.length).toBeGreaterThan(0);
  });

  it('throws on missing required parameters', async () => {
    await expect(adapter.execute('query-docs', {})).rejects.toThrow('query-docs requires "library" and "query"');
    await expect(adapter.execute('fetch-package-spec', {})).rejects.toThrow('fetch-package-spec requires "package"');
  });
});
