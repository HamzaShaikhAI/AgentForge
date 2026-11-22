import { describe, it, expect, beforeEach } from 'vitest';
import { PlaywrightAdapter } from './playwright.js';

describe('PlaywrightAdapter', () => {
  let adapter: PlaywrightAdapter;

  beforeEach(() => {
    adapter = new PlaywrightAdapter();
  });

  it('exposes correct metadata and category', () => {
    expect(adapter.name).toBe('playwright');
    expect(adapter.displayName).toBe('Playwright Browser Automation');
    expect(adapter.category).toBe('testing-automation');
    expect(adapter.version).toBe('1.0.0');
  });

  it('returns healthy status in simulation/active mode', async () => {
    const health = await adapter.checkHealth();
    expect(health.healthy).toBe(true);
    expect(health.status).toBe('connected');
    expect(health.details).toHaveProperty('headless', true);
  });

  it('declares all expected actions', () => {
    const actions = adapter.getActions().map(a => a.action);
    expect(actions).toContain('navigate');
    expect(actions).toContain('click');
    expect(actions).toContain('fill');
    expect(actions).toContain('evaluate');
    expect(actions).toContain('screenshot');
    expect(actions).toContain('pdf');
    expect(actions).toContain('get-content');
    expect(actions).toContain('inspect-accessibility');
    expect(actions).toContain('run-e2e-suite');
    expect(actions).toContain('close-browser');
  });

  it('navigates to url and extracts content', async () => {
    const nav = await adapter.execute('navigate', { url: 'https://example.com' }) as any;
    expect(nav.success).toBe(true);
    expect(nav.url).toBe('https://example.com');
    expect(nav.status).toBe(200);

    const content = await adapter.execute('get-content', {}) as any;
    expect(content.success).toBe(true);
    expect(content.html).toContain('Loaded Page');
  });

  it('clicks element and fills input', async () => {
    const clickRes = await adapter.execute('click', { selector: '#submit-btn' }) as any;
    expect(clickRes.success).toBe(true);
    expect(clickRes.clicked).toBe('#submit-btn');

    const fillRes = await adapter.execute('fill', { selector: 'input[name="search"]', value: 'AgentForge' }) as any;
    expect(fillRes.success).toBe(true);
    expect(fillRes.value).toBe('AgentForge');
  });

  it('captures screenshot and PDF', async () => {
    const screenRes = await adapter.execute('screenshot', { path: './shot.png' }) as any;
    expect(screenRes.success).toBe(true);
    expect(screenRes.format).toBe('png');
    expect(screenRes.base64).toBeDefined();

    const pdfRes = await adapter.execute('pdf', { path: './doc.pdf' }) as any;
    expect(pdfRes.success).toBe(true);
    expect(pdfRes.pageSize).toBe('A4');
  });

  it('inspects accessibility tree', async () => {
    const a11y = await adapter.execute('inspect-accessibility', {}) as any;
    expect(a11y.success).toBe(true);
    expect(a11y.role).toBe('WebArea');
    expect(a11y.children.length).toBeGreaterThan(0);
  });

  it('runs e2e test suite and closes browser', async () => {
    const testRes = await adapter.execute('run-e2e-suite', { specPath: './tests/e2e.spec.ts' }) as any;
    expect(testRes.success).toBe(true);
    expect(testRes.passed).toBe(12);

    const closeRes = await adapter.execute('close-browser', {}) as any;
    expect(closeRes.success).toBe(true);
  });

  it('throws on missing required parameters', async () => {
    await expect(adapter.execute('navigate', {})).rejects.toThrow('navigate requires "url" parameter');
    await expect(adapter.execute('click', {})).rejects.toThrow('click requires "selector" parameter');
    await expect(adapter.execute('fill', {})).rejects.toThrow('fill requires "selector" parameter');
  });
});
