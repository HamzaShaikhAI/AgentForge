import {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowRun,
  StepResult,
  StepStatus,
  BridgeManifest,
} from './types.js';
import { PermissionManager } from './permissions.js';
import { BridgeRegistry } from './bridge-registry.js';
import { StandardStepExecutor } from './executors/index.js';

export interface StepExecutor {
  /**
   * Execute a single workflow step.
   * Implementations should call actual bridge logic.
   */
  execute(step: WorkflowStep, inputs: Record<string, unknown>): Promise<unknown>;
}

/**
 * Workflow engine coordinates multi-step workflows.
 * 
 * Design principles:
 * - Antigravity remains the reasoning agent
 * - Engine handles ordering, dependency tracking, error reporting
 * - Each step requires permission checks before execution
 * - Results are recorded with timestamps
 * - Failures stop execution by default (unless step says otherwise)
 */
export class WorkflowEngine {
  private executor: StepExecutor;

  constructor(
    private registry: BridgeRegistry,
    private permissions: PermissionManager,
    executor?: StepExecutor,
  ) {
    this.executor = executor || new StandardStepExecutor();
  }

  /**
   * Create a new workflow run from a definition.
   */
  createRun(workflow: WorkflowDefinition): WorkflowRun {
    return {
      runId: this.generateId(),
      workflowId: workflow.id,
      status: 'pending',
      steps: workflow.steps.map(step => ({
        stepId: step.id,
        status: 'pending' as StepStatus,
      })),
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Execute a workflow run step-by-step.
   * Returns the completed run with all results.
   */
  async executeRun(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
  ): Promise<WorkflowRun> {
    run.status = 'running';

    for (const step of workflow.steps) {
      const stepResult = this.getStepResult(run, step.id);
      if (!stepResult) continue;

      // Do not re-execute steps that already completed in a prior pass
      if (stepResult.status === 'completed') {
        continue;
      }

      // Check dependencies
      if (step.dependsOn?.length) {
        const depsReady = step.dependsOn.every(depId => {
          const dep = this.getStepResult(run, depId);
          return dep?.status === 'completed';
        });
        if (!depsReady) {
          stepResult.status = 'skipped';
          stepResult.error = 'Dependencies not met';
          continue;
        }
      }

      // Check permissions with specific step inputs
      const bridge = this.registry.get(step.bridge);
      if (!bridge) {
        stepResult.status = 'failed';
        stepResult.error = `Bridge "${step.bridge}" not found in registry`;
        if (step.stopOnFailure !== false) {
          run.status = 'failed';
          run.error = `Step "${step.id}" failed: ${stepResult.error}`;
          run.completedAt = new Date().toISOString();
          return run;
        }
        continue;
      }

      const permCheck = this.permissions.checkPermission(bridge.manifest, step.action, step.inputs);
      if (!permCheck.allowed) {
        if (permCheck.requiresApproval) {
          stepResult.status = 'waiting-approval';
          stepResult.error = permCheck.reason;
          // Stop here — Antigravity should ask user for approval
          run.status = 'stopped';
          run.error = `Waiting for approval: ${permCheck.reason}`;
          run.completedAt = new Date().toISOString();
          return run;
        }
        stepResult.status = 'failed';
        stepResult.error = permCheck.reason;
        if (step.stopOnFailure !== false) {
          run.status = 'failed';
          run.error = `Step "${step.id}" not permitted: ${permCheck.reason}`;
          run.completedAt = new Date().toISOString();
          return run;
        }
        continue;
      }

      // Execute
      stepResult.status = 'running';
      stepResult.startedAt = new Date().toISOString();

      let attempts = 0;
      const maxAttempts = (step.retryable && step.maxRetries) ? step.maxRetries + 1 : 1;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          if (!this.executor) {
            throw new Error('No step executor configured');
          }
          const output = await this.executor.execute(step, step.inputs);
          stepResult.status = 'completed';
          stepResult.output = output;
          stepResult.completedAt = new Date().toISOString();
          break;
        } catch (e) {
          if (attempts >= maxAttempts) {
            stepResult.status = 'failed';
            stepResult.error = (e as Error).message;
            stepResult.completedAt = new Date().toISOString();

            if (step.stopOnFailure !== false) {
              run.status = 'failed';
              run.error = `Step "${step.id}" failed: ${stepResult.error}`;
              run.completedAt = new Date().toISOString();
              return run;
            }
          }
        }
      }
    }

    // All steps processed
    if (run.status === 'running') {
      const hasFailures = run.steps.some(s => s.status === 'failed');
      run.status = hasFailures ? 'failed' : 'completed';
      if (!hasFailures) {
        delete run.error;
      }
      run.completedAt = new Date().toISOString();
    }

    return run;
  }

  /**
   * Get a summary of a workflow run suitable for display.
   */
  summarizeRun(run: WorkflowRun): string {
    const lines: string[] = [
      `Workflow Run: ${run.runId}`,
      `Status: ${run.status}`,
      `Started: ${run.startedAt}`,
    ];
    if (run.completedAt) lines.push(`Completed: ${run.completedAt}`);
    if (run.error) lines.push(`Error: ${run.error}`);
    lines.push('');
    lines.push('Steps:');
    for (const step of run.steps) {
      const icon = this.statusIcon(step.status);
      let line = `  ${icon} ${step.stepId}: ${step.status}`;
      if (step.error) line += ` — ${step.error}`;
      lines.push(line);
    }
    return lines.join('\n');
  }

  private getStepResult(run: WorkflowRun, stepId: string): StepResult | undefined {
    return run.steps.find(s => s.stepId === stepId);
  }

  private statusIcon(status: StepStatus): string {
    const icons: Record<StepStatus, string> = {
      'pending': '○',
      'waiting-approval': '⏸',
      'approved': '✔',
      'running': '▶',
      'completed': '✅',
      'failed': '❌',
      'skipped': '⏭',
    };
    return icons[status] ?? '?';
  }

  private generateId(): string {
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
