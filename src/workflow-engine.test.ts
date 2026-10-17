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
    expect(result.status).toBe('paused_for_approval');
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

    // 1. Initial attempt without approval -> paused_for_approval
    let run = engine.createRun(publishWorkflow);
    run = await engine.executeRun(publishWorkflow, run);
    expect(run.status).toBe('paused_for_approval');
    expect(run.steps[0].status).toBe('waiting-approval');

    // 2. Approve for staging only -> still paused_for_approval!
    permissions.recordApproval('test-bridge', 'risky-action', 'publish', 'user', 'Staging only', {
      env: 'staging',
      version: '2.0.0',
    });
    run = await engine.executeRun(publishWorkflow, run);
    expect(run.status).toBe('paused_for_approval');
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

  describe('Milestone 5B — Input Resolution, Unified Dispatch, and Approval Checkpoints', () => {
    it('resolves step outputs dynamically with structured value preservation', () => {
      const run = engine.createRun(simpleWorkflow);
      run.steps[0].status = 'completed';
      run.steps[0].output = {
        meta: { id: 42, tags: ['alpha', 'beta'] },
        branch: 'main',
        secretToken: 'sk-12345678',
      };

      const resolved = engine.resolveStepInputs(
        {
          directDollar: '$steps.step-1.output.meta',
          directMustache: '{{steps.step-1.output.meta}}',
          stringInterpolated: 'Branch is {{steps.step-1.output.branch}} with tag {{steps.step-1.output.meta.tags.0}}',
          primitiveNumber: '$steps.step-1.output.meta.id',
          staticValue: 'unchanged',
        },
        run,
      );

      // Preserves structured object without stringifying
      expect(resolved.directDollar).toEqual({ id: 42, tags: ['alpha', 'beta'] });
      expect(resolved.directMustache).toEqual({ id: 42, tags: ['alpha', 'beta'] });
      // Preserves primitive number
      expect(resolved.primitiveNumber).toBe(42);
      // String interpolation works cleanly
      expect(resolved.stringInterpolated).toBe('Branch is main with tag alpha');
      expect(resolved.staticValue).toBe('unchanged');
    });

    it('rejects references to non-existent steps or uncompleted steps', () => {
      const run = engine.createRun(simpleWorkflow);
      // step-1 is still pending
      expect(() => {
        engine.resolveStepInputs({ param: '$steps.step-1.output.field' }, run);
      }).toThrow('has not completed successfully');

      expect(() => {
        engine.resolveStepInputs({ param: '$steps.nonexistent.output.field' }, run);
      }).toThrow('not found in workflow run');
    });

    it('rejects references to non-existent output fields', () => {
      const run = engine.createRun(simpleWorkflow);
      run.steps[0].status = 'completed';
      run.steps[0].output = { existing: 'yes' };

      expect(() => {
        engine.resolveStepInputs({ param: '$steps.step-1.output.missingField' }, run);
      }).toThrow('does not exist on output of step "step-1"');
    });

    it('prevents automatic retries on non-idempotent publish/destructive operations', async () => {
      let callCount = 0;
      const failingExecutor: StepExecutor = {
        execute: vi.fn().mockImplementation(async () => {
          callCount++;
          throw new Error('Network timeout during publish');
        }),
      };
      const customEngine = new WorkflowEngine(registry, permissions, failingExecutor);

      // Pre-approve publish action
      permissions.recordApproval('test-bridge', 'risky-action', 'publish', 'user', 'Approved', { target: 'npm' });

      const workflow: WorkflowDefinition = {
        id: 'no-retry-publish',
        name: 'No Retry Publish',
        description: 'Tests that non-idempotent actions are not automatically retried',
        steps: [
          {
            id: 'pub-step',
            name: 'Publish Step',
            bridge: 'test-bridge',
            action: 'risky-action',
            inputs: { target: 'npm' },
            retryable: true,
            maxRetries: 3, // Would retry 3 times if permitted
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = customEngine.createRun(workflow);
      const result = await customEngine.executeRun(workflow, run);

      expect(result.status).toBe('failed');
      // Assert it was only called ONCE because non-idempotent actions must not be blindly retried!
      expect(callCount).toBe(1);
    });

    it('allows retry on non-idempotent actions only when safeToRetry is explicitly set', async () => {
      let callCount = 0;
      const failingExecutor: StepExecutor = {
        execute: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 2) throw new Error('First try fails');
          return { released: true };
        }),
      };
      const customEngine = new WorkflowEngine(registry, permissions, failingExecutor);
      permissions.recordApproval('test-bridge', 'risky-action', 'publish', 'user', 'Approved', { target: 'npm' });

      const workflow: WorkflowDefinition = {
        id: 'safe-retry-publish',
        name: 'Safe Retry Publish',
        description: 'Explicit safeToRetry enables bounded retry',
        steps: [
          {
            id: 'pub-step',
            name: 'Publish Step',
            bridge: 'test-bridge',
            action: 'risky-action',
            inputs: { target: 'npm' },
            retryable: true,
            maxRetries: 2,
            safeToRetry: true, // Idempotency explicitly confirmed
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = customEngine.createRun(workflow);
      const result = await customEngine.executeRun(workflow, run);

      expect(result.status).toBe('completed');
      expect(callCount).toBe(2);
    });

    it('supports durable approval checkpoints, input binding, and resumeRun', async () => {
      const publishWorkflow: WorkflowDefinition = {
        id: 'durable-approval-wf',
        name: 'Durable Approval Workflow',
        description: 'Tests full checkpoint, approval, and resume cycle',
        steps: [
          { id: 'step-1', name: 'Safe Step', bridge: 'test-bridge', action: 'safe-action', inputs: { id: 100 } },
          { id: 'step-2', name: 'Risky Step', bridge: 'test-bridge', action: 'risky-action', inputs: { target: 'prod', tag: 'v1.0' }, dependsOn: ['step-1'] },
        ],
        createdAt: new Date().toISOString(),
      };

      let run = engine.createRun(publishWorkflow);
      run = await engine.executeRun(publishWorkflow, run);

      // Paused at approval checkpoint
      expect(run.status).toBe('paused_for_approval');
      expect(run.steps[0].status).toBe('completed');
      expect(run.steps[1].status).toBe('waiting-approval');
      expect(run.pendingApproval).toBeDefined();
      expect(run.pendingApproval?.action).toBe('risky-action');
      expect(run.pendingApproval?.inputs).toEqual({ target: 'prod', tag: 'v1.0' });

      const reqId = run.pendingApproval!.approvalRequestId;

      // Reject mismatched inputs
      await expect(
        engine.approveStep(run.runId, reqId, {
          approvedBy: 'operator',
          confirmed: true,
          expectedInputs: { target: 'staging', tag: 'v1.0' }, // Mismatched!
        }),
      ).rejects.toThrow('provided inputs do not match');

      // Reject without user identity
      await expect(
        engine.approveStep(run.runId, reqId, {
          approvedBy: '',
          confirmed: true,
        }),
      ).rejects.toThrow('explicit approvedBy user identity');

      // Explicit valid approval
      const approvedRun = await engine.approveStep(run.runId, reqId, {
        approvedBy: 'alice',
        confirmed: true,
        reason: 'Release verified',
        expectedInputs: { target: 'prod', tag: 'v1.0' },
      });
      expect(approvedRun.pendingApproval?.status).toBe('approved');
      expect(approvedRun.steps[1].status).toBe('approved');

      // Cannot re-approve an already approved request
      await expect(
        engine.approveStep(run.runId, reqId, {
          approvedBy: 'alice',
          confirmed: true,
        }),
      ).rejects.toThrow('is not pending');

      // Resume run
      const resumedRun = await engine.resumeRun(publishWorkflow, approvedRun);
      expect(resumedRun.status).toBe('completed');
      expect(resumedRun.steps[1].status).toBe('completed');
      expect(resumedRun.pendingApproval?.status).toBe('consumed');
      // Step 1 was not re-executed
      expect(executor.execute).toHaveBeenCalledTimes(2);
    });

    it('cancels active workflow runs cooperatively', async () => {
      const workflow: WorkflowDefinition = {
        id: 'cancel-wf',
        name: 'Cancel Workflow',
        description: 'Tests cancellation',
        steps: [
          { id: 'step-1', name: 'Step 1', bridge: 'test-bridge', action: 'safe-action', inputs: {} },
          { id: 'step-2', name: 'Step 2', bridge: 'test-bridge', action: 'safe-action', inputs: {} },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = engine.createRun(workflow);
      const cancelledRun = await engine.cancelRun(run.runId, 'Operator requested abort');
      expect(cancelledRun.status).toBe('cancelled');
      expect(cancelledRun.error).toBe('Operator requested abort');
      expect(cancelledRun.steps.every(s => s.status === 'cancelled')).toBe(true);
    });
  });
});

