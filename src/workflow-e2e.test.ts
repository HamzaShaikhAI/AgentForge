import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { WorkflowEngine } from './workflow-engine.js';
import { BridgeRegistry } from './bridge-registry.js';
import { PermissionManager } from './permissions.js';
import { McpManager } from './mcp/index.js';
import { McpClient, McpServerState, McpDiscoveredTool } from './mcp/types.js';
import { WorkflowDefinition, BridgeManifest } from './types.js';
import { StepExecutor } from './executors/index.js';

describe('Workflow Orchestration End-to-End Verification (Milestone 5B)', () => {
  let tempStorageDir: string;
  let registry: BridgeRegistry;
  let permissions: PermissionManager;
  let mcpManager: McpManager;
  let engine: WorkflowEngine;

  // Mock call counters
  let gitStatusCallCount = 0;
  let gitDiffCallCount = 0;
  let mcpLintCallCount = 0;
  let mcpTestCallCount = 0;
  let mcpReleaseCallCount = 0;

  // Mock bridge manifest
  const mockGitBridge: BridgeManifest = {
    schema: '1.0',
    name: 'mock-git',
    displayName: 'Mock Git Integration (Test Only)',
    description: 'Simulates local git status and diff operations',
    version: '1.0.0',
    capabilities: [
      { action: 'status-check', description: 'Inspect git status', permissionLevel: 'read', sideEffects: false },
      { action: 'diff-review', description: 'Review git diff', permissionLevel: 'read', sideEffects: false },
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'status-check', level: 'read', requiresApproval: false },
      { actions: 'diff-review', level: 'read', requiresApproval: false },
    ],
  };

  // Mock step executor for built-in bridges
  const mockExecutor: StepExecutor = {
    execute: vi.fn().mockImplementation(async (step, inputs) => {
      if (step.bridge === 'mock-git' && step.action === 'status-check') {
        gitStatusCallCount++;
        return {
          branch: 'feature/blocks',
          clean: false,
          headCommit: 'e8a31fc (mock commit)',
          uncommitted: ['README.md'],
          meta: { isMock: true, label: 'MOCK_GIT_STATUS' },
        };
      }
      if (step.bridge === 'mock-git' && step.action === 'diff-review') {
        gitDiffCallCount++;
        return {
          branch: inputs.branch,
          filesChanged: 1,
          diff: 'diff --git a/README.md b/README.md\n+Mock change content',
          meta: { isMock: true, label: 'MOCK_GIT_DIFF' },
        };
      }
      throw new Error(`Unknown mock action "${step.action}" on bridge "${step.bridge}"`);
    }),
  };

  // Mock external MCP client for CI/CD server
  class MockMcpCiClient implements McpClient {
    readonly config = {
      id: 'mock-ci',
      name: 'Mock MCP CI/CD Server (Test Only)',
      transport: 'stdio' as const,
    };

    private state: McpServerState = {
      id: 'mock-ci',
      name: 'Mock MCP CI/CD Server (Test Only)',
      transport: 'stdio',
      status: 'connected',
      tools: [
        {
          name: 'code_lint',
          description: 'Run code linter on target files',
          permissionLevel: 'read',
          requiresApproval: false,
          inputSchema: {
            type: 'object',
            properties: {
              filesChanged: { type: 'number' },
            },
            required: ['filesChanged'],
          },
        },
        {
          name: 'run_tests',
          description: 'Run test suites',
          permissionLevel: 'read',
          requiresApproval: false,
          inputSchema: {
            type: 'object',
            properties: {
              suite: { type: 'string' },
            },
            required: ['suite'],
          },
        },
        {
          name: 'publish_release',
          description: 'Publish release externally',
          permissionLevel: 'publish',
          requiresApproval: true,
          inputSchema: {
            type: 'object',
            properties: {
              tag: { type: 'string' },
              branch: { type: 'string' },
              releaseNotes: { type: 'string' },
            },
            required: ['tag', 'branch'],
          },
        },
      ],
      config: this.config,
    };

    async connect(): Promise<void> {
      this.state.status = 'connected';
    }

    async disconnect(): Promise<void> {
      this.state.status = 'disconnected';
    }

    async ping(): Promise<boolean> {
      return true;
    }

    async listTools(): Promise<McpDiscoveredTool[]> {
      return this.state.tools;
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      if (name === 'code_lint') {
        mcpLintCallCount++;
        return {
          linterPassed: true,
          filesChecked: args.filesChanged,
          meta: { isMock: true, label: 'MOCK_MCP_LINTER' },
        };
      }
      if (name === 'run_tests') {
        mcpTestCallCount++;
        return {
          suite: args.suite,
          passed: 42,
          failed: 0,
          meta: { isMock: true, label: 'MOCK_MCP_TESTS' },
        };
      }
      if (name === 'publish_release') {
        mcpReleaseCallCount++;
        return {
          releaseId: 'rel-98765',
          tag: args.tag,
          branch: args.branch,
          publishedUrl: `https://github.com/mock-org/mock-repo/releases/tag/${args.tag}`,
          meta: { isMock: true, label: 'MOCK_MCP_RELEASE' },
        };
      }
      throw new Error(`Tool "${name}" not found on MockMcpCiClient`);
    }

    getState(): McpServerState {
      return { ...this.state };
    }
  }

  // 5-step mock release workflow
  const releaseWorkflow: WorkflowDefinition = {
    id: 'e2e-release-workflow',
    name: 'E2E Mock Release Workflow',
    description: 'Inspect status, review diff, run lint and tests, pause for release approval, and release',
    steps: [
      {
        id: 'step-status',
        name: 'Check Git Status',
        bridge: 'mock-git',
        action: 'status-check',
        inputs: {},
      },
      {
        id: 'step-diff',
        name: 'Review Git Diff',
        bridge: 'mock-git',
        action: 'diff-review',
        inputs: {
          branch: '$steps.step-status.output.branch',
        },
        dependsOn: ['step-status'],
      },
      {
        id: 'step-lint',
        name: 'Run MCP Code Linter',
        bridge: 'mcp:mock-ci',
        action: 'code_lint',
        inputs: {
          filesChanged: '$steps.step-diff.output.filesChanged',
        },
        dependsOn: ['step-diff'],
      },
      {
        id: 'step-test',
        name: 'Run MCP Test Suite',
        bridge: 'mcp:mock-ci',
        action: 'run_tests',
        inputs: {
          suite: 'all',
        },
        dependsOn: ['step-lint'],
      },
      {
        id: 'step-release',
        name: 'Publish Remote Release',
        bridge: 'mcp:mock-ci',
        action: 'publish_release',
        inputs: {
          tag: 'v1.2.0',
          branch: '{{steps.step-status.output.branch}}',
          releaseNotes: 'Mock release notes for {{steps.step-diff.output.filesChanged}} changed file(s)',
        },
        dependsOn: ['step-test'],
      },
    ],
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    gitStatusCallCount = 0;
    gitDiffCallCount = 0;
    mcpLintCallCount = 0;
    mcpTestCallCount = 0;
    mcpReleaseCallCount = 0;

    tempStorageDir = join(tmpdir(), `agentforge-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    registry = new BridgeRegistry(join(tempStorageDir, 'bridges'));
    permissions = new PermissionManager();
    mcpManager = new McpManager({ storagePath: join(tempStorageDir, 'mcp.json'), permissions });

    // Register bridges and MCP clients
    registry.register(mockGitBridge, 'mock-git.json');
    mcpManager.registerClient(new MockMcpCiClient());

    engine = new WorkflowEngine(
      registry,
      permissions,
      {
        storageDir: tempStorageDir,
        mcpManager,
        executor: mockExecutor,
      },
    );
  });

  afterEach(() => {
    if (existsSync(tempStorageDir)) {
      try {
        rmSync(tempStorageDir, { recursive: true, force: true });
      } catch {
        // cleanup ignore
      }
    }
  });

  it('executes full E2E workflow: inspects repo, pauses at approval, resumes after user approval, and prevents replay', async () => {
    // ─── Phase 1: Start Run & Pause at Approval Checkpoint ───────────────────
    let run = engine.createRun(releaseWorkflow);
    run = await engine.executeRun(releaseWorkflow, run);

    // 1. Verify repository status was inspected
    expect(gitStatusCallCount).toBe(1);
    expect(run.steps[0].status).toBe('completed');
    expect((run.steps[0].output as any).branch).toBe('feature/blocks');

    // 2. Verify diff was reviewed with resolved branch input
    expect(gitDiffCallCount).toBe(1);
    expect(run.steps[1].status).toBe('completed');
    expect((run.steps[1].output as any).filesChanged).toBe(1);

    // 3. Verify mock lint and test actions executed via external MCP
    expect(mcpLintCallCount).toBe(1);
    expect(run.steps[2].status).toBe('completed');
    expect((run.steps[2].output as any).linterPassed).toBe(true);

    expect(mcpTestCallCount).toBe(1);
    expect(run.steps[3].status).toBe('completed');
    expect((run.steps[3].output as any).passed).toBe(42);

    // 4. Verify paused before simulated release
    expect(run.status).toBe('paused_for_approval');
    expect(run.steps[4].status).toBe('waiting-approval');
    expect(run.pendingApproval).toBeDefined();

    // 5. Assert release action has NOT executed
    expect(mcpReleaseCallCount).toBe(0);

    const checkpoint = run.pendingApproval!;
    expect(checkpoint.provider).toBe('mcp:mock-ci');
    expect(checkpoint.action).toBe('publish_release');
    expect(checkpoint.permissionLevel).toBe('publish');
    expect(checkpoint.inputs).toEqual({
      tag: 'v1.2.0',
      branch: 'feature/blocks',
      releaseNotes: 'Mock release notes for 1 changed file(s)',
    });

    // ─── Phase 2: Test Approval Validation, Rejection, and Stale Handling ────

    // Reject changed / tampered inputs
    await expect(
      engine.approveStep(run.runId, checkpoint.approvalRequestId, {
        approvedBy: 'lead-dev',
        confirmed: true,
        expectedInputs: { tag: 'v2.0.0', branch: 'feature/blocks', releaseNotes: 'different' },
      }),
    ).rejects.toThrow('provided inputs do not match pending approval inputs');

    // Reject empty approval identity
    await expect(
      engine.approveStep(run.runId, checkpoint.approvalRequestId, {
        approvedBy: '',
        confirmed: true,
      }),
    ).rejects.toThrow('explicit approvedBy user identity');

    // Reject invalid request ID
    await expect(
      engine.approveStep(run.runId, 'invalid-req-id', {
        approvedBy: 'lead-dev',
        confirmed: true,
      }),
    ).rejects.toThrow('not found or does not match');

    // ─── Phase 3: Grant Explicit Approval ────────────────────────────────────

    // 6. Approve the exact pending operation
    const approvedRun = await engine.approveStep(run.runId, checkpoint.approvalRequestId, {
      approvedBy: 'release-lead',
      confirmed: true,
      reason: 'Diff inspected and CI tests passing; ready for production release',
      expectedInputs: checkpoint.inputs,
    });

    expect(approvedRun.pendingApproval?.status).toBe('approved');
    expect(approvedRun.pendingApproval?.approvedBy).toBe('release-lead');
    expect(approvedRun.steps[4].status).toBe('approved');

    // ─── Phase 4: Resume Execution & Verify Single Side-Effect ───────────────

    // 7. Resume and assert release executes exactly once
    const completedRun = await engine.resumeRun(releaseWorkflow, approvedRun);
    expect(completedRun.status).toBe('completed');
    expect(completedRun.steps[4].status).toBe('completed');
    expect((completedRun.steps[4].output as any).releaseId).toBe('rel-98765');
    expect((completedRun.steps[4].output as any).meta.label).toBe('MOCK_MCP_RELEASE');

    // Assert release was called exactly once
    expect(mcpReleaseCallCount).toBe(1);
    // Assert prior steps were NOT re-executed
    expect(gitStatusCallCount).toBe(1);
    expect(gitDiffCallCount).toBe(1);
    expect(mcpLintCallCount).toBe(1);
    expect(mcpTestCallCount).toBe(1);

    // ─── Phase 5: Simulate Process Restart / Recovery ─────────────────────────

    // 8. Simulate restart/recovery and verify completed steps are not repeated
    const reloadedEngine = new WorkflowEngine(
      registry,
      permissions,
      {
        storageDir: tempStorageDir,
        mcpManager,
        executor: mockExecutor,
      },
    );

    const reloadedRun = await reloadedEngine.resumeRun(releaseWorkflow, run.runId);
    expect(reloadedRun.status).toBe('completed');
    // None of the side effects or read actions ran again
    expect(mcpReleaseCallCount).toBe(1);
    expect(gitStatusCallCount).toBe(1);
  });

  it('tests cancellation, retry limits, non-idempotent protections, and secret redaction', async () => {
    // ─── Test 1: Cooperative Cancellation ───────────────────────────────────
    const cancelWorkflow: WorkflowDefinition = {
      id: 'cancel-test',
      name: 'Cancel Test',
      description: 'Cancel in progress',
      steps: [
        { id: 'step-1', name: 'Step 1', bridge: 'mock-git', action: 'status-check', inputs: {} },
        { id: 'step-2', name: 'Step 2', bridge: 'mock-git', action: 'status-check', inputs: {}, dependsOn: ['step-1'] },
      ],
      createdAt: new Date().toISOString(),
    };

    const runToCancel = engine.createRun(cancelWorkflow);
    const cancelled = await engine.cancelRun(runToCancel.runId, 'User triggered manual abort');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toBe('User triggered manual abort');
    expect(cancelled.steps.every(s => s.status === 'cancelled')).toBe(true);

    // ─── Test 2: Non-Idempotent Retry Policy Protection ─────────────────────
    let failingReleaseCalls = 0;
    const failingMcpClient: McpClient = {
      config: { id: 'fail-ci', name: 'Fail CI', transport: 'stdio' },
      async connect() {},
      async disconnect() {},
      async ping() { return true; },
      async listTools() { return []; },
      async callTool() {
        failingReleaseCalls++;
        throw new Error('Simulated external release network error');
      },
      getState() {
        return {
          id: 'fail-ci',
          name: 'Fail CI',
          transport: 'stdio',
          status: 'connected',
          tools: [
            {
              name: 'failing_publish',
              permissionLevel: 'publish',
              requiresApproval: true,
            },
          ],
          config: { id: 'fail-ci', name: 'Fail CI', transport: 'stdio' },
        };
      },
    };

    mcpManager.registerClient(failingMcpClient);
    permissions.recordApproval('mcp:fail-ci', 'failing_publish', 'publish', 'user', 'Pre-approved', { target: 'prod' });

    const nonIdempotentWorkflow: WorkflowDefinition = {
      id: 'non-idempotent-wf',
      name: 'Non Idempotent Workflow',
      description: 'Verify publish actions are not blindly retried',
      steps: [
        {
          id: 'failing-pub',
          name: 'Failing Publish Step',
          bridge: 'mcp:fail-ci',
          action: 'failing_publish',
          inputs: { target: 'prod' },
          retryable: true,
          maxRetries: 3, // Requesting 3 retries
        },
      ],
      createdAt: new Date().toISOString(),
    };

    const failRun = engine.createRun(nonIdempotentWorkflow);
    const failResult = await engine.executeRun(nonIdempotentWorkflow, failRun);

    expect(failResult.status).toBe('failed');
    // Critical: non-idempotent publish operations are not automatically retried
    expect(failingReleaseCalls).toBe(1);

    // ─── Test 3: Secret Redaction in Persisted History ───────────────────────
    const secretWorkflow: WorkflowDefinition = {
      id: 'secret-wf',
      name: 'Secret Workflow',
      description: 'Tests sensitive value redaction in run history',
      steps: [
        {
          id: 'step-secret',
          name: 'Step with Secret',
          bridge: 'mock-git',
          action: 'status-check',
          inputs: {
            publicConfig: 'normal',
            api_key: 'sk-live-super-secret-token-12345',
            client_secret: 'topsecret999',
          },
        },
      ],
      createdAt: new Date().toISOString(),
    };

    const secretRun = engine.createRun(secretWorkflow);
    await engine.executeRun(secretWorkflow, secretRun);

    // Read the actual persisted file from disk
    const persistedPath = join(tempStorageDir, `${secretRun.runId}.json`);
    expect(existsSync(persistedPath)).toBe(true);

    const fileContent = readFileSync(persistedPath, 'utf-8');
    // Ensure secrets are NEVER persisted in plaintext
    expect(fileContent).not.toContain('sk-live-super-secret-token-12345');
    expect(fileContent).not.toContain('topsecret999');
    expect(fileContent).toContain('[REDACTED]');
  });
});
