import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server } from 'node:http';
import { createManagerServer } from './serve.js';

describe('Manager Server & Security Tests', () => {
  let server: Server;
  let tempAuthDir: string;
  const TEST_PORT = 9471;
  const baseUrl = `http://localhost:${TEST_PORT}`;

  beforeAll(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    tempAuthDir = await mkdtemp(join(tmpdir(), 'agentforge-manager-test-'));
    process.env.AGENTFORGE_CREDENTIALS_DIR = tempAuthDir;

    server = createManagerServer(TEST_PORT);
    await new Promise<void>((resolvePromise) => {
      server.listen(TEST_PORT, () => resolvePromise());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise());
    });
    delete process.env.AGENTFORGE_CREDENTIALS_DIR;
    try {
      const { rm } = await import('node:fs/promises');
      await rm(tempAuthDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      const { rmSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const testBridgeDir = join(process.cwd(), 'bridges', 'manager-staged-fs');
      if (existsSync(testBridgeDir)) {
        rmSync(testBridgeDir, { recursive: true, force: true });
      }
      const testStagedDir = join(process.cwd(), 'data', 'staging-bridges', 'manager-staged-fs');
      if (existsSync(testStagedDir)) {
        rmSync(testStagedDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
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
    expect(body).toHaveProperty('google');
    expect(body.google).toHaveProperty('status');
    expect(body.google).toHaveProperty('clientConfigured');
    expect(body).toHaveProperty('youtube');
    expect(body.youtube).toHaveProperty('available');
    expect(body.youtube).toHaveProperty('hasScope');
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

  describe('Google OAuth API Endpoints', () => {
    it('GET /api/auth/google/status returns connection and auth mode information', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/status`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('onboardingState');
      expect(data).toHaveProperty('authMode');
      expect(data).toHaveProperty('clientConfigured');
      expect(data).toHaveProperty('storageBackend');
    });

    it('POST /api/auth/google/connect returns 400 when onboardingState is "Not configured"', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/connect`, {
        method: 'POST',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('not_configured');
      expect(body.onboardingState).toBe('Not configured');
      expect(body.message).toContain('pending official publisher client registration');
    });

    it('POST /api/auth/google/configure validates payload and saves developer credentials', async () => {
      // 1. Rejects missing clientId
      const badRes = await fetch(`${baseUrl}/api/auth/google/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(badRes.status).toBe(400);
      const badBody = await badRes.json();
      expect(badBody.success).toBe(false);

      // 2. Rejects placeholder clientId
      const placeholderRes = await fetch(`${baseUrl}/api/auth/google/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'custom-manager-client.apps.googleusercontent.com',
          clientSecret: 'custom-secret',
        }),
      });
      expect(placeholderRes.status).toBe(400);
      const placeholderBody = await placeholderRes.json();
      expect(placeholderBody.success).toBe(false);
      expect(placeholderBody.error).toContain('placeholder');

      // 3. Rejects malformed clientId
      const malformedRes = await fetch(`${baseUrl}/api/auth/google/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'not-a-valid-google-client',
        }),
      });
      expect(malformedRes.status).toBe(400);
      const malformedBody = await malformedRes.json();
      expect(malformedBody.success).toBe(false);

      // 4. Accepts valid Desktop app clientId
      const okRes = await fetch(`${baseUrl}/api/auth/google/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: '123456789012-abcdef123456.apps.googleusercontent.com',
          clientSecret: 'custom-secret',
        }),
      });
      expect(okRes.status).toBe(200);
      const okBody = await okRes.json();
      expect(okBody.success).toBe(true);
      expect(okBody.configPath).toBeDefined();

      // 5. POST /api/auth/google/reset cleans up config
      const resetRes = await fetch(`${baseUrl}/api/auth/google/reset`, {
        method: 'POST',
      });
      expect(resetRes.status).toBe(200);
      const resetBody = await resetRes.json();
      expect(resetBody.success).toBe(true);
      expect(resetBody.deletedConfig).toBe(true);
    });

    it('POST /api/auth/google/logout successfully revokes and clears credentials', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/logout`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe('Catalog & External MCP API Endpoints', () => {
    it('GET /api/catalog returns unified catalog summary and items', async () => {
      const res = await fetch(`${baseUrl}/api/catalog`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('summary');
      expect(body).toHaveProperty('items');
      expect(body.summary.builtinBridges).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('manages external MCP server lifecycle via REST API', async () => {
      // 1. Initial list
      const listRes1 = await fetch(`${baseUrl}/api/mcp/servers`);
      expect(listRes1.status).toBe(200);
      const list1 = await listRes1.json();
      expect(Array.isArray(list1)).toBe(true);

      // 2. Add an MCP server
      const addRes = await fetch(`${baseUrl}/api/mcp/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-api-mcp',
          name: 'Test API MCP',
          transport: 'stdio',
          command: 'node',
          args: ['-e', 'process.exit(0)'],
          autoConnect: false,
        }),
      });
      expect(addRes.status).toBe(201);
      const addBody = await addRes.json();
      expect(addBody.success).toBe(true);
      expect(addBody.server.id).toBe('test-api-mcp');

      // 3. Verify in list
      const listRes2 = await fetch(`${baseUrl}/api/mcp/servers`);
      const list2 = await listRes2.json();
      expect(list2.some((s: any) => s.id === 'test-api-mcp')).toBe(true);

      // 4. Test server connection (ping)
      const testRes = await fetch(`${baseUrl}/api/mcp/servers/test-api-mcp/test`, {
        method: 'POST',
      });
      expect(testRes.status).toBe(200);

      // 5. Delete MCP server
      const delRes = await fetch(`${baseUrl}/api/mcp/servers/test-api-mcp`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);
      const delBody = await delRes.json();
      expect(delBody.success).toBe(true);

      // 6. Verify removed
      const listRes3 = await fetch(`${baseUrl}/api/mcp/servers`);
      const list3 = await listRes3.json();
      expect(list3.some((s: any) => s.id === 'test-api-mcp')).toBe(false);
    });
  });

  describe('Workflow Run API & Security Checkpoints', () => {
    it('GET /api/workflows/predefined returns predefined workflows', async () => {
      const res = await fetch(`${baseUrl}/api/workflows/predefined`);
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(Array.isArray(list)).toBe(true);
      expect(list.some((w: any) => w.id === 'git-status-check')).toBe(true);
      expect(list.some((w: any) => w.id === 'mock-release-pipeline')).toBe(true);
      expect(list.some((w: any) => w.id === 'youtube-channel-inspect')).toBe(true);
    });

    it('validates workflow start requests via POST /api/workflows/runs', async () => {
      // 1. Missing workflowId and workflow
      const badRes = await fetch(`${baseUrl}/api/workflows/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AgentForge-Client': 'manager' },
        body: JSON.stringify({}),
      });
      expect(badRes.status).toBe(400);

      // 2. Non-existent workflowId
      const notFoundRes = await fetch(`${baseUrl}/api/workflows/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AgentForge-Client': 'manager' },
        body: JSON.stringify({ workflowId: 'non-existent-flow' }),
      });
      expect(notFoundRes.status).toBe(404);
    });

    it('starts and executes a read-only workflow (git-status-check)', async () => {
      const startRes = await fetch(`${baseUrl}/api/workflows/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AgentForge-Client': 'manager' },
        body: JSON.stringify({ workflowId: 'git-status-check' }),
      });
      expect(startRes.status).toBe(201);
      const startBody = await startRes.json();
      expect(startBody.success).toBe(true);
      expect(startBody.run).toBeDefined();
      const runId = startBody.run.id;

      // Inspect via GET /api/workflows/runs/:id
      const inspectRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}`);
      expect(inspectRes.status).toBe(200);
      const inspectBody = await inspectRes.json();
      expect(inspectBody.run.id).toBe(runId);
      expect(inspectBody.run.status).toBe('completed');
      expect(inspectBody.run.steps.length).toBeGreaterThanOrEqual(2);
      expect(inspectBody.run.steps.every((s: any) => s.status === 'completed')).toBe(true);
    });

    it('pauses for approval checkpoint and enforces security invariants', async () => {
      // 1. Start mock-release-pipeline which contains publish-example requiring approval
      const startRes = await fetch(`${baseUrl}/api/workflows/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AgentForge-Client': 'manager' },
        body: JSON.stringify({ workflowId: 'mock-release-pipeline' }),
      });
      expect(startRes.status).toBe(201);
      const startBody = await startRes.json();
      const runId = startBody.run.id;
      expect(startBody.run.status).toBe('paused_for_approval');

      // 2. Inspect pending approval via GET /api/workflows/runs/:id/approval
      const apprRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/approval`);
      expect(apprRes.status).toBe(200);
      const apprBody = await apprRes.json();
      expect(apprBody.checkpoint).toBeDefined();
      expect(apprBody.checkpoint.stepId).toBe('publish-release');
      expect(apprBody.checkpoint.action).toBe('publish-example');
      expect(apprBody.checkpoint.provider).toBe('example-echo');
      expect(apprBody.consequences).toBeDefined();
      expect(apprBody.consequences.permissionLevel).toBe('publish');
      const approvalRequestId = apprBody.checkpoint.approvalRequestId;
      expect(approvalRequestId).toBeDefined();

      // 3. Security invariant: Rejects cross-origin CSRF attempt (Origin: http://evil.com)
      const csrfRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://evil.com',
        },
        body: JSON.stringify({
          approvalRequestId,
          approvedBy: 'Attacker',
          expectedInputs: apprBody.checkpoint.inputs,
        }),
      });
      expect(csrfRes.status).toBe(403);

      // 4. Security invariant: Rejects approval without operator identity
      const noOpRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentForge-Client': 'manager',
        },
        body: JSON.stringify({
          approvalRequestId,
          approvedBy: '',
          expectedInputs: apprBody.checkpoint.inputs,
        }),
      });
      expect(noOpRes.status).toBe(400);

      // 5. Security invariant: Rejects approval with mismatched inputs
      const badInputsRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentForge-Client': 'manager',
        },
        body: JSON.stringify({
          approvalRequestId,
          approvedBy: 'Local Operator',
          expectedInputs: { target: 'different-target' },
        }),
      });
      expect(badInputsRes.status).toBe(400);

      // 6. Security rejection: Reject the action via POST /api/workflows/runs/:id/reject
      const rejectRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentForge-Client': 'manager',
        },
        body: JSON.stringify({
          approvalRequestId,
          rejectedBy: 'Lead Auditor',
          reason: 'Artifact review pending',
        }),
      });
      expect(rejectRes.status).toBe(200);
      const rejectBody = await rejectRes.json();
      expect(['stopped', 'failed']).toContain(rejectBody.run.status);

      // 7. Check audit log via GET /api/approvals
      const auditRes = await fetch(`${baseUrl}/api/approvals`);
      expect(auditRes.status).toBe(200);
      const auditBody = await auditRes.json();
      expect(Array.isArray(auditBody.approvals)).toBe(true);
      const rejectedLog = auditBody.approvals.find(
        (a: any) => a.action === 'publish-example' && a.status === 'rejected',
      );
      expect(rejectedLog).toBeDefined();
      expect(rejectedLog.rejectedBy).toBe('Lead Auditor');
    });

    it('approves checkpoint, resumes execution, and records audit trail', async () => {
      // 1. Start a new run
      const startRes = await fetch(`${baseUrl}/api/workflows/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AgentForge-Client': 'manager' },
        body: JSON.stringify({ workflowId: 'mock-release-pipeline' }),
      });
      const startBody = await startRes.json();
      const runId = startBody.run.id;
      expect(startBody.run.status).toBe('paused_for_approval');

      // 2. Fetch pending checkpoint
      const apprRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/approval`);
      const apprBody = await apprRes.json();
      const { approvalRequestId, inputs } = apprBody.checkpoint;

      // 3. Approve via POST /api/workflows/runs/:id/approve
      const approveRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentForge-Client': 'manager',
        },
        body: JSON.stringify({
          approvalRequestId,
          approvedBy: 'DevOps Specialist',
          reason: 'Verified all checks passed',
          expectedInputs: inputs,
        }),
      });
      expect(approveRes.status).toBe(200);
      const approveBody = await approveRes.json();
      expect(approveBody.success).toBe(true);
      expect(approveBody.run.status).toBe('completed');

      // 4. Audit trail verification
      const auditRes = await fetch(`${baseUrl}/api/approvals`);
      const auditBody = await auditRes.json();
      const approvedLog = auditBody.approvals.find(
        (a: any) => a.action === 'publish-example' && a.status === 'approved',
      );
      expect(approvedLog).toBeDefined();
      expect(approvedLog.approvedBy).toBe('DevOps Specialist');
    });

    it('cancels active or paused workflow runs via POST /api/workflows/runs/:id/cancel', async () => {
      // Start a run that pauses
      const startRes = await fetch(`${baseUrl}/api/workflows/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AgentForge-Client': 'manager' },
        body: JSON.stringify({ workflowId: 'mock-release-pipeline' }),
      });
      const startBody = await startRes.json();
      const runId = startBody.run.id;

      // Cancel it
      const cancelRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/cancel`, {
        method: 'POST',
        headers: { 'X-AgentForge-Client': 'manager' },
      });
      expect(cancelRes.status).toBe(200);
      const cancelBody = await cancelRes.json();
      expect(cancelBody.success).toBe(true);
      expect(cancelBody.run.status).toBe('cancelled');
    });
  });

  describe('Custom Bridge Builder Endpoints', () => {
    it('analyzes bridge strategy via POST /api/builder/analyze', async () => {
      const res = await fetch(`${baseUrl}/api/builder/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create bridge to manage local files' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.strategy.type).toBe('needs-custom-bridge');
      expect(body.strategy.suggestedActions).toContain('list-files');
    });

    it('generates a staged bridge via POST /api/builder/generate', async () => {
      const res = await fetch(`${baseUrl}/api/builder/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Local project file management',
          targetName: 'manager-staged-fs',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.staged.name).toBe('manager-staged-fs');
      expect(body.staged.status).toBe('draft');
    });

    it('lists staged bridges via GET /api/builder/staged', async () => {
      const res = await fetch(`${baseUrl}/api/builder/staged`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.staged)).toBe(true);
      expect(body.staged.some((s: any) => s.name === 'manager-staged-fs')).toBe(true);
    });

    it('validates and runs isolated tests on staged bridge via API', async () => {
      // Validate
      const valRes = await fetch(`${baseUrl}/api/builder/staged/manager-staged-fs/validate`, {
        method: 'POST',
      });
      expect(valRes.status).toBe(200);
      const valBody = await valRes.json();
      expect(valBody.staged.validationResult.valid).toBe(true);
      expect(valBody.staged.securityCheck.passed).toBe(true);

      // Run isolated tests
      const testRes = await fetch(`${baseUrl}/api/builder/staged/manager-staged-fs/test`, {
        method: 'POST',
      });
      expect(testRes.status).toBe(200);
      const testBody = await testRes.json();
      expect(testBody.staged.status).toBe('awaiting-review');
      expect(testBody.staged.testResult.passed).toBe(true);
    }, 15000);

    it('registers approved bridge via POST /api/builder/staged/:id/register', async () => {
      const regRes = await fetch(`${baseUrl}/api/builder/staged/manager-staged-fs/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedBy: 'Lead Architect',
          reviewNotes: 'Reviewed isolated test results and path traversal protections',
        }),
      });
      expect(regRes.status).toBe(200);
      const regBody = await regRes.json();
      expect(regBody.staged.status).toBe('registered');
      expect(regBody.staged.reviewedBy).toBe('Lead Architect');
    });

    it('deletes staged bridge draft via DELETE /api/builder/staged/:id', async () => {
      // Create a temp draft
      await fetch(`${baseUrl}/api/builder/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'temporary service', targetName: 'to-delete-draft' }),
      });

      const delRes = await fetch(`${baseUrl}/api/builder/staged/to-delete-draft`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);
      const delBody = await delRes.json();
      expect(delBody.success).toBe(true);
    });
  });
});

