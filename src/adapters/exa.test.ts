import { describe, it, expect, beforeEach } from 'vitest';
import { ExaAdapter } from './exa.js';

describe('ExaAdapter', () => {
  let adapter: ExaAdapter;

  beforeEach(() => {
    adapter = new ExaAdapter();
  });

  it('exposes correct metadata and category', () => {
    expect(adapter.name).toBe('exa');
    expect(adapter.displayName).toBe('Exa Semantic Search');
    expect(adapter.category).toBe('search-research');
    expect(adapter.version).toBe('1.0.0');
  });

  it('performs neural semantic search', async () => {
    const res = await adapter.execute('search', {
      query: 'Agentic workflow frameworks in TypeScript',
      numResults: 5,
    }) as any;

    expect(res.success).toBe(true);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].score).toBeGreaterThan(0.8);
  });

  it('finds similar pages and extracts contents', async () => {
    const sim = await adapter.execute('find-similar', {
      url: 'https://modelcontextprotocol.io',
    }) as any;
    expect(sim.success).toBe(true);
    expect(sim.similarPages.length).toBeGreaterThan(0);

    const cont = await adapter.execute('get-contents', {
      urls: ['https://modelcontextprotocol.io'],
    }) as any;
    expect(cont.success).toBe(true);
    expect(cont.contents[0].highlights.length).toBeGreaterThan(0);
  });

  it('runs search-and-contents and academic research', async () => {
    const hybrid = await adapter.execute('search-and-contents', {
      query: 'PostgreSQL read replica synchronization',
    }) as any;
    expect(hybrid.success).toBe(true);
    expect(hybrid.results[0].text).toBeDefined();

    const acad = await adapter.execute('academic-research', {
      topic: 'Formal verification of multi-agent state machines',
    }) as any;
    expect(acad.success).toBe(true);
    expect(acad.papers.length).toBeGreaterThan(0);
  });

  it('throws on missing required parameters', async () => {
    await expect(adapter.execute('search', {})).rejects.toThrow('search requires "query" parameter');
    await expect(adapter.execute('find-similar', {})).rejects.toThrow('find-similar requires "url" parameter');
    await expect(adapter.execute('get-contents', {})).rejects.toThrow('get-contents requires "urls" array');
  });
});
