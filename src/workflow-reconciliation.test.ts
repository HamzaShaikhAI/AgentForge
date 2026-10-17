import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine } from './workflow-engine.js';
import { BridgeRegistry } from './bridge-registry.js';
import { PermissionManager } from './permissions.js';
import { WorkflowDefinition, StepExecutor } from './types.js';
import { resolve } from 'node:path';

describe('WorkflowEngine — Reconciliation State & Side-Effect Safety (Phase 1)', () => {
  let registry: BridgeRegistry;
  let permissions: PermissionManager;
  let engine: WorkflowEngine;
  let mockExecutor: StepExecutor;

  beforeEach(async () => {
    registry = new BridgeRegistry(resolve(import.meta.dirname, '..', 'bridges'));
    await registry.discover();
    permissions = new PermissionManager();
    mockExecutor = {
      execute: vi.fn(),
    };
    engine = new WorkflowEngine(registry, permissions, mockExecutor);
  });

  it('pauses in needs_reconciliation state on ambiguous network timeout for side-effect operations', async () => {
    const workflow: WorkflowDefinition = {
      id: 'side-effect-pipeline',
      name: 'Side Effect Test Pipeline',
      steps: [
        {
          id: 'step-read',
          name: 'Inspect Status',
          bridge: 'github',
          action: 'status-check',
          inputs: {},
        },
        {
          id: 'step-push',
          name: 'Push Commits (Side Effect)',
          bridge: 'github',
          action: 'push-commits',
          inputs: { remote: 'origin', branch: 'master' },
          dependsOn: ['step-read'],
          maxRetries: 3, // Would normally retry 3 times
        },
      ],
    };

    // Pre-approve external write for step-push in permissions manager
    permissions.recordApproval('github', 'push-commits', 'external-write', 'operator');

    // First step succeeds
    vi.mocked(mockExecutor.execute).mockImplementation(async (step) => {
      if (step.id === 'step-read') return { clean: true };
      if (step.id === 'step-push') {
        throw new Error('ETIMEDOUT connection to remote git server timed out after 30000ms');
      }
      return {};
    });

    const run = await engine.run(workflow);

    // Verify it halted and did NOT retry 3 times
    expect(vi.mocked(mockExecutor.execute)).toHaveBeenCalledTimes(2); // exactly 1 read + 1 push attempt
    expect(run.status).toBe('needs_reconciliation');
    expect(run.reconciliation).toBeDefined();
    expect(run.reconciliation?.stepId).toBe('step-push');
    expect(run.reconciliation?.action).toBe('push-commits');
    expect(run.reconciliation?.options).toContain('verify_remote_state');
    expect(run.reconciliation?.options).toContain('mark_completed');

    const stepResult = run.steps.find(s => s.stepId === 'step-push');
    expect(stepResult?.status).toBe('needs_reconciliation');
    expect(stepResult?.error).toContain('Ambiguous execution failure');
  });

  it('prevents standard resumeRun when a workflow is in needs_reconciliation state', async () => {
    const workflow: WorkflowDefinition = {
      id: 'reconciliation-block-test',
      name: 'Reconciliation Block Test',
      steps: [
        {
          id: 'step-upload',
          name: 'Upload Video',
          bridge: 'youtube',
          action: 'video-upload',
          inputs: { filePath: 'test.mp4', title: 'Test' },
        },
      ],
    };

    permissions.recordApproval('youtube', 'video-upload', 'publish', 'operator');

    vi.mocked(mockExecutor.execute).mockRejectedValue(new Error('504 Gateway Timeout'));

    const run = await engine.run(workflow);
    expect(run.status).toBe('needs_reconciliation');

    await expect(engine.resumeRun(run.runId)).rejects.toThrow(/requires reconciliation before continuing/);
  });

  it('supports resolving reconciliation via mark_completed and continues workflow', async () => {
    const workflow: WorkflowDefinition = {
      id: 'reconciliation-resolve-test',
      name: 'Reconciliation Resolve Test',
      steps: [
        {
          id: 'step-push',
          name: 'Push Commits',
          bridge: 'github',
          action: 'push-commits',
          inputs: {},
        },
        {
          id: 'step-verify',
          name: 'Verify Tags',
          bridge: 'github',
          action: 'status-check',
          inputs: {},
          dependsOn: ['step-push'],
        },
      ],
    };

    permissions.recordApproval('github', 'push-commits', 'external-write', 'operator');

    vi.mocked(mockExecutor.execute).mockImplementation(async (step) => {
      if (step.id === 'step-push') {
        throw new Error('socket hang up during git push');
      }
      return { verified: true };
    });

    const run = await engine.run(workflow);
    expect(run.status).toBe('needs_reconciliation');

    // Operator verifies remote state and calls reconcileRun with mark_completed
    const resumedRun = await engine.reconcileRun(run.runId, 'mark_completed', {
      notes: 'Checked git remote: commits were successfully received before connection drop',
      outputOverride: { remote: 'origin', pushed: true, verifiedViaInspection: true },
    });

    expect(resumedRun.status).toBe('completed');
    const pushStep = resumedRun.steps.find(s => s.stepId === 'step-push');
    expect(pushStep?.status).toBe('completed');
    expect(pushStep?.output).toEqual({ remote: 'origin', pushed: true, verifiedViaInspection: true });
    expect(pushStep?.reconciliation?.resolutionDecision).toBe('mark_completed');

    const verifyStep = resumedRun.steps.find(s => s.stepId === 'step-verify');
    expect(verifyStep?.status).toBe('completed');
  });

  it('supports resolving reconciliation via mark_failed', async () => {
    const workflow: WorkflowDefinition = {
      id: 'reconcile-fail-test',
      name: 'Reconcile Fail Test',
      steps: [
        {
          id: 'step-push',
          name: 'Push Commits',
          bridge: 'github',
          action: 'push-commits',
          inputs: {},
        },
      ],
    };

    permissions.recordApproval('github', 'push-commits', 'external-write', 'operator');

    vi.mocked(mockExecutor.execute).mockRejectedValue(new Error('504 Gateway Timeout'));

    const run = await engine.run(workflow);
    expect(run.status).toBe('needs_reconciliation');

    const failedRun = await engine.reconcileRun(run.runId, 'mark_failed', {
      notes: 'Remote probe confirmed changes were rejected by remote proxy',
    });

    expect(failedRun.status).toBe('failed');
    expect(failedRun.error).toContain('Remote probe confirmed changes were rejected');
  });
});
