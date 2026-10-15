import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowEngine, StepExecutor } from './workflow-engine.js';
import { BridgeRegistry } from './bridge-registry.js';
import { PermissionManager } from './permissions.js';
import { WorkflowDefinition, BridgeManifest } from './types.js';

const testBridge: BridgeManifest = {
  schema: '1.0',
  name: 'test-bridge',
  displayName: 'Test',
  description: 'Test',
  version: '1.0.0',
  capabilities: [
    { action: 'safe-action', description: 'Safe', permissionLevel: 'read', sideEffects: false },
    { action: 'risky-action', description: 'Risky', permissionLevel: 'publish', sideEffects: true },
  ],
  integrations: [],
  auth: [],
  permissions: [
    { actions: 'safe-action', level: 'read', requiresApproval: false },
    { actions: 'risky-action', level: 'publish', requiresApproval: true },
  ],
};

const simpleWorkflow: WorkflowDefinition = {
  id: 'test-workflow',
  name: 'Test Workflow',
  description: 'A simple test workflow',
  steps: [
    { id: 'step-1', name: 'Step 1', bridge: 'test-bridge', action: 'safe-action', inputs: { msg: 'hello' } },
    { id: 'step-2', name: 'Step 2', bridge: 'test-bridge', action: 'safe-action', inputs: { msg: 'world' }, dependsOn: ['step-1'] },
  ],
  createdAt: new Date().toISOString(),
};

describe('WorkflowEngine', () => {
  let registry: BridgeRegistry;
  let permissions: PermissionManager;
  let engine: WorkflowEngine;
  let executor: StepExecutor;

  beforeEach(() => {
    registry = new BridgeRegistry('c:/tmp/bridges');
    permissions = new PermissionManager();
    executor = { execute: vi.fn().mockResolvedValue({ result: 'ok' }) };
    engine = new WorkflowEngine(registry, permissions, executor);

    // Register the test bridge
    registry.register(testBridge, 'test-bridge.json');
  });

  it('creates a run with pending steps', () => {
    const run = engine.createRun(simpleWorkflow);
    expect(run.status).toBe('pending');
    expect(run.steps).toHaveLength(2);
    expect(run.steps.every(s => s.status === 'pending')).toBe(true);
  });

  it('executes a simple workflow successfully', async () => {
    const run = engine.createRun(simpleWorkflow);
    const result = await engine.executeRun(simpleWorkflow, run);
    expect(result.status).toBe('completed');
    expect(result.steps.every(s => s.status === 'completed')).toBe(true);
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });

  it('stops when approval is required', async () => {
    const workflow: WorkflowDefinition = {
      id: 'approval-test',
      name: 'Approval Test',
      description: 'Tests approval flow',
      steps: [
        { id: 'step-1', name: 'Risky Step', bridge: 'test-bridge', action: 'risky-action', inputs: {} },
      ],
      createdAt: new Date().toISOString(),
    };

    const run = engine.createRun(workflow);
    const result = await engine.executeRun(workflow, run);
    expect(result.status).toBe('stopped');
    expect(result.steps[0].status).toBe('waiting-approval');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('fails when bridge is not found', async () => {
    const workflow: WorkflowDefinition = {
      id: 'missing-bridge',
      name: 'Missing Bridge',
      description: 'References a non-existent bridge',
      steps: [
        { id: 'step-1', name: 'Bad Step', bridge: 'nonexistent', action: 'foo', inputs: {} },
      ],
      createdAt: new Date().toISOString(),
    };

    const run = engine.createRun(workflow);
    const result = await engine.executeRun(workflow, run);
    expect(result.status).toBe('failed');
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error).toContain('not found');
  });

  it('skips steps with unmet dependencies', async () => {
    const failExecutor: StepExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const failEngine = new WorkflowEngine(registry, permissions, failExecutor);

    const workflow: WorkflowDefinition = {
      id: 'dep-test',
      name: 'Dependency Test',
      description: 'Step 2 depends on step 1',
      steps: [
        { id: 'step-1', name: 'Step 1', bridge: 'test-bridge', action: 'safe-action', inputs: {}, stopOnFailure: false },
        { id: 'step-2', name: 'Step 2', bridge: 'test-bridge', action: 'safe-action', inputs: {}, dependsOn: ['step-1'] },
      ],
      createdAt: new Date().toISOString(),
    };

    const run = failEngine.createRun(workflow);
    const result = await failEngine.executeRun(workflow, run);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[1].status).toBe('skipped');
  });

  it('retries failed steps when configured', async () => {
    let callCount = 0;
    const retryExecutor: StepExecutor = {
      execute: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) throw new Error('transient');
        return { result: 'ok' };
      }),
    };
    const retryEngine = new WorkflowEngine(registry, permissions, retryExecutor);

    const workflow: WorkflowDefinition = {
      id: 'retry-test',
      name: 'Retry Test',
      description: 'Tests retry logic',
      steps: [
        { id: 'step-1', name: 'Retryable', bridge: 'test-bridge', action: 'safe-action', inputs: {}, retryable: true, maxRetries: 3 },
      ],
      createdAt: new Date().toISOString(),
    };

    const run = retryEngine.createRun(workflow);
    const result = await retryEngine.executeRun(workflow, run);
    expect(result.status).toBe('completed');
    expect(retryExecutor.execute).toHaveBeenCalledTimes(3);
  });

  it('does not re-execute completed steps upon resuming a stopped workflow', async () => {
    const run = engine.createRun(simpleWorkflow);
    // Execute step 1 only
    const step1OnlyWorkflow: WorkflowDefinition = {
      ...simpleWorkflow,
      steps: [simpleWorkflow.steps[0]],
    };
    await engine.executeRun(step1OnlyWorkflow, run);
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(run.steps[0].status).toBe('completed');

    // Resume full workflow with step 1 already completed
    await engine.executeRun(simpleWorkflow, run);
    // executor should only have been called 1 MORE time (for step 2), not 2 more times!
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(run.steps[1].status).toBe('completed');
  });

  it('records failed step truthfully without reporting success', async () => {
    const errorExecutor: StepExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('Fatal execution failure')),
    };
    const failEngine = new WorkflowEngine(registry, permissions, errorExecutor);

    const run = failEngine.createRun(simpleWorkflow);
    const result = await failEngine.executeRun(simpleWorkflow, run);

    expect(result.status).toBe('failed');
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error).toBe('Fatal execution failure');
    expect(result.error).toContain('Fatal execution failure');
  });

  it('enforces input-bound approval in multi-step workflow', async () => {
    const publishWorkflow: WorkflowDefinition = {
      id: 'publish-wf',
      name: 'Publish Workflow',
      description: 'Tests publish approval with specific inputs',
      steps: [
        {
          id: 'step-pub',
          name: 'Publish to Prod',
          bridge: 'test-bridge',
          action: 'risky-action',
          inputs: { env: 'production', version: '2.0.0' },
        },
      ],
      createdAt: new Date().toISOString(),
    };

    // 1. Initial attempt without approval -> stopped
    let run = engine.createRun(publishWorkflow);
    run = await engine.executeRun(publishWorkflow, run);
    expect(run.status).toBe('stopped');
    expect(run.steps[0].status).toBe('waiting-approval');

    // 2. Approve for staging only -> still stopped!
    permissions.recordApproval('test-bridge', 'risky-action', 'publish', 'user', 'Staging only', {
      env: 'staging',
      version: '2.0.0',
    });
    run = await engine.executeRun(publishWorkflow, run);
    expect(run.status).toBe('stopped');
    expect(run.steps[0].status).toBe('waiting-approval');

    // 3. Approve for production -> proceeds!
    permissions.recordApproval('test-bridge', 'risky-action', 'publish', 'user', 'Prod approved', {
      env: 'production',
      version: '2.0.0',
    });
    run = await engine.executeRun(publishWorkflow, run);
    expect(run.status).toBe('completed');
    expect(run.steps[0].status).toBe('completed');
  });

  it('summarizes a run with status icons', () => {
    const run = engine.createRun(simpleWorkflow);
    run.steps[0].status = 'completed';
    run.steps[1].status = 'failed';
    run.steps[1].error = 'Something went wrong';
    const summary = engine.summarizeRun(run);
    expect(summary).toContain('completed');
    expect(summary).toContain('failed');
    expect(summary).toContain('Something went wrong');
  });
});

