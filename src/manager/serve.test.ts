import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server } from 'node:http';
import { createManagerServer } from './serve.js';

describe('Manager Server & Security Tests', () => {
  let server: Server;
  const TEST_PORT = 9471;
  const baseUrl = `http://localhost:${TEST_PORT}`;

  beforeAll(async () => {
    server = createManagerServer(TEST_PORT);
    await new Promise<void>((resolvePromise) => {
      server.listen(TEST_PORT, () => resolvePromise());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise());
    });
  });

  it('serves health status via GET /api/status', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.bridgesCount).toBeGreaterThanOrEqual(2);
  });

  it('serves bridge list via GET /api/bridges', async () => {
    const res = await fetch(`${baseUrl}/api/bridges`);
    expect(res.status).toBe(200);
    const bridges = await res.json();
    expect(Array.isArray(bridges)).toBe(true);
    expect(bridges.some((b: any) => b.manifest.name === 'github')).toBe(true);
  });

  it('serves integration status via GET /api/integrations', async () => {
    const res = await fetch(`${baseUrl}/api/integrations`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('git');
    expect(body.git.available).toBe(true);
    expect(body.githubCli.available).toBe(false);
  });

  it('validates manifest drafts via POST /api/validate', async () => {
    const validDraft = {
      schema: '1.0',
      name: 'draft-bridge',
      displayName: 'Draft Bridge',
      description: 'Draft description',
      version: '0.1.0',
      capabilities: [
        { action: 'ping', description: 'ping', permissionLevel: 'read', sideEffects: false },
      ],
      integrations: [],
      auth: [],
      permissions: [{ actions: '*', level: 'read', requiresApproval: false }],
    };

    const res = await fetch(`${baseUrl}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDraft),
    });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.valid).toBe(true);

    // Invalid draft
    const badRes = await fetch(`${baseUrl}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'INVALID!' }),
    });
    expect(badRes.status).toBe(200);
    const badResult = await badRes.json();
    expect(badResult.valid).toBe(false);
    expect(badResult.errors.length).toBeGreaterThan(0);
  });

  it('serves dashboard index.html on root path', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('AgentForge Manager');
  });

  it('prevents path traversal attacks and arbitrary file reads (Security Invariant)', async () => {
    // Attempt to read package.json in parent directory
    const traversal1 = await fetch(`${baseUrl}/../package.json`);
    expect([403, 404]).toContain(traversal1.status);
    const body1 = await traversal1.text();
    expect(body1).not.toContain('"agentforge"');

    // Attempt url-encoded traversal
    const traversal2 = await fetch(`${baseUrl}/%2e%2e%2fpackage.json`);
    expect([400, 403, 404]).toContain(traversal2.status);
    const body2 = await traversal2.text();
    expect(body2).not.toContain('"agentforge"');

    // Attempt root / Windows hosts file read
    const traversal3 = await fetch(`${baseUrl}/../../../../Windows/win.ini`);
    expect([403, 404]).toContain(traversal3.status);
  });
});
