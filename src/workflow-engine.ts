import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowRun,
  WorkflowRunStatus,
  StepResult,
  StepStatus,
  ApprovalCheckpoint,
  PermissionLevel,
  WorkflowDryRunResult,
  WorkflowDryRunStep,
} from './types.js';
import { PermissionManager, PermissionCheckResult } from './permissions.js';
import { BridgeRegistry } from './bridge-registry.js';
import { StandardStepExecutor } from './executors/index.js';
import { McpManager } from './mcp/index.js';
import { redactObject } from './auth/index.js';

export interface StepExecutor {
  execute(step: WorkflowStep, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface WorkflowEngineOptions {
  storageDir?: string;
  mcpManager?: McpManager;
  executor?: StepExecutor;
}

export interface ApprovalDecision {
  approvedBy: string;
  confirmed: boolean;
  reason?: string;
  expectedInputs?: Record<string, unknown>;
}

/**
 * Workflow engine coordinates multi-step workflows.
 * 
 * Design principles:
 * - Antigravity remains the reasoning agent
 * - Engine handles ordering, dependency tracking, error reporting
 * - Each step requires permission checks before execution
 * - Dynamic step input/output resolution with structured preservation
 * - Durable approval checkpoints bound to exact inputs and identities
 * - Crash and retry protection for non-idempotent operations
 * - Cooperative abort signals and persistence with sensitive value redaction
 */
export class WorkflowEngine {
  private executor: StepExecutor;
  private mcpManager?: McpManager;
  private storageDir?: string;
  private runs = new Map<string, WorkflowRun>();
  private workflows = new Map<string, WorkflowDefinition>();
  private activeControllers = new Map<string, AbortController>();

  constructor(
    private registry: BridgeRegistry,
    private permissions: PermissionManager,
    executorOrOptions?: StepExecutor | WorkflowEngineOptions,
    mcpManager?: McpManager,
  ) {
    if (executorOrOptions && typeof (executorOrOptions as StepExecutor).execute === 'function') {
      this.executor = executorOrOptions as StepExecutor;
      this.mcpManager = mcpManager;
    } else {
      const opts = (executorOrOptions || {}) as WorkflowEngineOptions;
      this.mcpManager = opts.mcpManager || mcpManager;
      this.storageDir = opts.storageDir;
      this.executor = opts.executor || new StandardStepExecutor(undefined, this.mcpManager);
    }
    if (this.mcpManager) {
      this.mcpManager.setPermissionManager(this.permissions);
    }
  }

  getExecutor(): StepExecutor {
    return this.executor;
  }

  /**

   * Create a new workflow run from a definition.
   */
  createRun(workflow: WorkflowDefinition): WorkflowRun {
    this.workflows.set(workflow.id, workflow);
    const run: WorkflowRun = {
      runId: this.generateId(),
      workflowId: workflow.id,
      status: 'pending',
      steps: workflow.steps.map(step => ({
        stepId: step.id,
        status: 'pending' as StepStatus,
      })),
      startedAt: new Date().toISOString(),
    };
    this.runs.set(run.runId, run);
    return run;
  }

  /**
   * Create and execute a workflow run in a single call.
   */
  async run(workflow: WorkflowDefinition, options?: { signal?: AbortSignal }): Promise<WorkflowRun> {
    const run = this.createRun(workflow);
    return this.executeRun(workflow, run, options);
  }

  /**
   * Start a workflow run by workflow definition or ID with optional initial inputs.
   */
  async startRun(
    workflowOrId: WorkflowDefinition | string,
    initialInputs?: Record<string, unknown>,
  ): Promise<WorkflowRun> {
    let workflow: WorkflowDefinition;
    if (typeof workflowOrId === 'string') {
      const found = this.workflows.get(workflowOrId);
      if (!found) {
        throw new Error(`Workflow "${workflowOrId}" not found`);
      }
      workflow = found;
    } else {
      workflow = workflowOrId;
      this.workflows.set(workflow.id, workflow);
    }

    const run = this.createRun(workflow);
    if (initialInputs && Object.keys(initialInputs).length > 0 && workflow.steps.length > 0) {
      workflow.steps[0].inputs = { ...workflow.steps[0].inputs, ...initialInputs };
    }

    return this.executeRun(workflow, run);
  }

  registerWorkflow(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  /**
   * Resolves dynamic step inputs from completed steps in the run.
   * Supports:
   * - $steps.<step-id>.output.<field>
   * - {{steps.<step-id>.output.<field>}}
   * Preserves structured values when the reference represents an entire input.
   */
  resolveStepInputs(
    inputs: Record<string, unknown>,
    run: WorkflowRun,
  ): Record<string, unknown> {
    const resolveValue = (val: unknown): unknown => {
      if (typeof val === 'string') {
        // Interpolate environment variables: ${env:VAR} and {{env.VAR}} / {{ env.VAR }}
        let processed = val.replace(/\$\{env:([a-zA-Z0-9_]+)\}/g, (_m, key) => process.env[key] ?? '');
        processed = processed.replace(/\{\{\s*env\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => process.env[key] ?? '');

        // Direct reference preserving structured values
        const dollarMatch = processed.match(/^\$steps\.([a-zA-Z0-9_-]+)\.output(?:\.(.+))?$/);
        if (dollarMatch) {
          return this.lookupStepOutput(dollarMatch[1], dollarMatch[2], run);
        }

        const exactMustacheMatch = processed.match(/^\{\{\s*steps\.([a-zA-Z0-9_-]+)\.output(?:\.(.+?))?\s*\}\}$/);
        if (exactMustacheMatch) {
          return this.lookupStepOutput(exactMustacheMatch[1], exactMustacheMatch[2], run);
        }

        // Interpolated string: replaces {{steps.<id>.output.<field>}}
        if (processed.includes('{{') && processed.includes('}}')) {
          return processed.replace(/\{\{\s*steps\.([a-zA-Z0-9_-]+)\.output(?:\.(.+?))?\s*\}\}/g, (_match, stepId, fieldPath) => {
            const resolved = this.lookupStepOutput(stepId, fieldPath, run);
            if (typeof resolved === 'object' && resolved !== null) {
              return JSON.stringify(resolved);
            }
            return String(resolved ?? '');
          });
        }

        return processed;
      }

      if (Array.isArray(val)) {
        return val.map(item => resolveValue(item));
      }

      if (val !== null && typeof val === 'object') {
        const res: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          res[k] = resolveValue(v);
        }
        return res;
      }

      return val;
    };

    const resolved: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(inputs)) {
      resolved[key] = resolveValue(val);
    }
    return resolved;
  }

  private lookupStepOutput(stepId: string, fieldPath: string | undefined, run: WorkflowRun): unknown {
    const stepResult = run.steps.find(s => s.stepId === stepId);
    if (!stepResult) {
      throw new Error(`Step reference error: step "${stepId}" not found in workflow run`);
    }
    if (stepResult.status !== 'completed') {
      throw new Error(`Step reference error: step "${stepId}" has not completed successfully (current status: "${stepResult.status}")`);
    }

    let rawPath = fieldPath?.trim();
    let filters: string[] = [];
    if (rawPath && rawPath.includes('|')) {
      const parts = rawPath.split('|').map(p => p.trim());
      rawPath = parts[0];
      filters = parts.slice(1);
    }

    const output = stepResult.output;
    let current: any = output;

    if (rawPath && rawPath.length > 0) {
      for (const part of rawPath.split('.')) {
        if (current === null || current === undefined || typeof current !== 'object') {
          throw new Error(`Step reference error: field "${fieldPath}" does not exist on output of step "${stepId}"`);
        }
        if (!(part in current)) {
          throw new Error(`Step reference error: field "${fieldPath}" does not exist on output of step "${stepId}"`);
        }
        current = current[part];
      }
    }

    for (const filter of filters) {
      current = this.applyFilter(current, filter);
    }

    return current;
  }

  private applyFilter(val: any, filter: string): unknown {
    const trimmed = filter.trim();
    switch (trimmed) {
      case 'upper':
        return String(val ?? '').toUpperCase();
      case 'lower':
        return String(val ?? '').toLowerCase();
      case 'trim':
        return String(val ?? '').trim();
      case 'json':
        return typeof val === 'string' ? val : JSON.stringify(val);
      case 'length':
        if (Array.isArray(val)) return val.length;
        if (typeof val === 'string') return val.length;
        if (val !== null && typeof val === 'object') return Object.keys(val).length;
        return 0;
      default:
        return val;
    }
  }

  /**
   * Safely evaluate a step condition against the workflow run state.
   */
  evaluateCondition(condition: string, run: WorkflowRun): boolean {
    const trimmed = condition.trim();
    if (!trimmed) return true;

    const resolveContextVal = (path: string): unknown => {
      const parts = path.trim().split('.');
      if (parts[0] !== 'steps') {
        return undefined;
      }
      const stepId = parts[1];
      const stepRes = run.steps.find(s => s.stepId === stepId);
      if (!stepRes) return undefined;
      if (parts.length === 2) return stepRes;
      if (parts[2] === 'status') return stepRes.status;
      if (parts[2] === 'output') {
        let current: any = stepRes.output;
        for (let i = 3; i < parts.length; i++) {
          if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
          }
          current = current[parts[i]];
        }
        return current;
      }
      if (parts[2] === 'inputs') {
        let current: any = stepRes.inputs;
        for (let i = 3; i < parts.length; i++) {
          if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
          }
          current = current[parts[i]];
        }
        return current;
      }
      return undefined;
    };

    if (trimmed.startsWith('!')) {
      const inner = trimmed.slice(1).trim();
      const val = resolveContextVal(inner);
      return !val;
    }

    const opRegex = /^(.*?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.*)$/;
    const match = trimmed.match(opRegex);
    if (match) {
      const rawLeft = match[1].trim();
      const op = match[2];
      const rawRight = match[3].trim();

      const parseLiteral = (lit: string): unknown => {
        if (lit === 'true') return true;
        if (lit === 'false') return false;
        if (lit === 'null') return null;
        if (lit === 'undefined') return undefined;
        if ((lit.startsWith("'") && lit.endsWith("'")) || (lit.startsWith('"') && lit.endsWith('"'))) {
          return lit.slice(1, -1);
        }
        const num = Number(lit);
        if (!isNaN(num) && lit !== '') return num;
        if (lit.startsWith('steps.')) {
          return resolveContextVal(lit);
        }
        return lit;
      };

      const leftVal = rawLeft.startsWith('steps.') ? resolveContextVal(rawLeft) : parseLiteral(rawLeft);
      const rightVal = parseLiteral(rawRight);

      switch (op) {
        case '===':
        case '==':
          return leftVal === rightVal || String(leftVal) === String(rightVal);
        case '!==':
        case '!=':
          return leftVal !== rightVal && String(leftVal) !== String(rightVal);
        case '>':
          return Number(leftVal) > Number(rightVal);
        case '<':
          return Number(leftVal) < Number(rightVal);
        case '>=':
          return Number(leftVal) >= Number(rightVal);
        case '<=':
          return Number(leftVal) <= Number(rightVal);
      }
    }

    if (trimmed.startsWith('steps.')) {
      const val = resolveContextVal(trimmed);
      return Boolean(val);
    }

    return true;
  }

  /**
   * Execute a workflow run step-by-step.
   * Returns the updated run with all results.
   */
  async executeRun(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    options?: { signal?: AbortSignal },
  ): Promise<WorkflowRun> {
    run.status = 'running';
    delete run.error;

    const controller = new AbortController();
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }
    this.activeControllers.set(run.runId, controller);

    try {
      for (const step of workflow.steps) {
        if (controller.signal.aborted || (run.status as WorkflowRunStatus) === 'cancelled') {
          run.status = 'cancelled';
          run.error = 'Workflow run cancelled';
          await this.saveRun(run);
          return run;
        }

        const stepResult = this.getStepResult(run, step.id);
        if (!stepResult) continue;

        // Do not re-execute steps that already completed in a prior pass
        if (stepResult.status === 'completed') {
          continue;
        }

        // Interrupted crash recovery check for non-idempotent operations
        if (stepResult.status === 'running') {
          stepResult.status = 'failed';
          stepResult.error = `Interrupted execution detected for step "${step.id}". Automatic replay disabled to prevent duplicate side effects.`;
          run.status = 'failed';
          run.error = stepResult.error;
          await this.saveRun(run);
          return run;
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

        // Evaluate dynamic condition if defined
        if (step.condition) {
          const shouldRun = this.evaluateCondition(step.condition, run);
          if (!shouldRun) {
            stepResult.status = 'skipped';
            stepResult.error = `Condition evaluated to false: "${step.condition}"`;
            continue;
          }
        }

        // Dynamically resolve step inputs
        let resolvedInputs: Record<string, unknown>;
        try {
          resolvedInputs = this.resolveStepInputs(step.inputs, run);

          // For YouTube video publishing, automatically enrich inputs with exact file hash and size if file exists on disk
          if (step.bridge === 'youtube' && step.action === 'video-upload') {
            if (typeof resolvedInputs.filePath === 'string' && resolvedInputs.filePath.trim()) {
              const targetPath = resolvedInputs.filePath.trim();
              if (existsSync(targetPath)) {
                try {
                  const fileStat = await stat(targetPath);
                  if (fileStat.isFile()) {
                    if (resolvedInputs.fileSize === undefined) {
                      resolvedInputs.fileSize = fileStat.size;
                    }
                    if (resolvedInputs.fileSha256 === undefined) {
                      const fileContent = await readFile(targetPath);
                      resolvedInputs.fileSha256 = createHash('sha256').update(fileContent).digest('hex');
                    }
                  }
                } catch {
                  // File access error handled downstream by executor
                }
              }
            }
          }

          stepResult.inputs = resolvedInputs;
        } catch (err) {
          stepResult.status = 'failed';
          stepResult.error = (err as Error).message;
          if (step.stopOnFailure !== false) {
            await this.runCleanupSteps(workflow, run);
            run.status = 'failed';
            run.error = `Step "${step.id}" input resolution failed: ${stepResult.error}`;
            run.completedAt = new Date().toISOString();
            await this.saveRun(run);
            return run;
          }
          continue;
        }

        // Unified dispatch permission and schema check
        let permCheck: PermissionCheckResult;
        let providerIdent: string;
        let actionIdent: string;

        if (step.bridge.startsWith('mcp:')) {
          const serverId = step.bridge.slice(4);
          providerIdent = step.bridge;
          actionIdent = step.action;

          if (!this.mcpManager) {
            stepResult.status = 'failed';
            stepResult.error = `No McpManager configured to handle MCP step for "${step.bridge}"`;
            if (step.stopOnFailure !== false) {
              run.status = 'failed';
              run.error = stepResult.error;
              run.completedAt = new Date().toISOString();
              await this.saveRun(run);
              return run;
            }
            continue;
          }

          const match = this.mcpManager.findTool(serverId, step.action);
          if (!match) {
            stepResult.status = 'failed';
            stepResult.error = `MCP tool "${step.action}" on server "${serverId}" not found or server is not connected`;
            if (step.stopOnFailure !== false) {
              run.status = 'failed';
              run.error = stepResult.error;
              run.completedAt = new Date().toISOString();
              await this.saveRun(run);
              return run;
            }
            continue;
          }

          // Schema validation
          try {
            this.mcpManager.validateInputs(match.tool.inputSchema, resolvedInputs);
          } catch (err) {
            stepResult.status = 'failed';
            stepResult.error = `Schema validation failed: ${(err as Error).message}`;
            if (step.stopOnFailure !== false) {
              run.status = 'failed';
              run.error = stepResult.error;
              run.completedAt = new Date().toISOString();
              await this.saveRun(run);
              return run;
            }
            continue;
          }

          permCheck = this.mcpManager.checkToolPermission(serverId, match.tool, resolvedInputs);
        } else {
          providerIdent = step.bridge;
          actionIdent = step.action;
          const bridge = this.registry.get(step.bridge);
          if (!bridge) {
            stepResult.status = 'failed';
            stepResult.error = `Bridge "${step.bridge}" not found in registry`;
            if (step.stopOnFailure !== false) {
              await this.runCleanupSteps(workflow, run);
              run.status = 'failed';
              run.error = `Step "${step.id}" failed: ${stepResult.error}`;
              run.completedAt = new Date().toISOString();
              await this.saveRun(run);
              return run;
            }
            continue;
          }

          permCheck = this.permissions.checkPermission(bridge.manifest, step.action, resolvedInputs);
        }

        // Permission check enforcement
        if (!permCheck.allowed) {
          if (permCheck.requiresApproval) {
            const approvalRequestId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const checkpoint: ApprovalCheckpoint = {
              approvalRequestId,
              runId: run.runId,
              stepId: step.id,
              provider: providerIdent,
              action: actionIdent,
              permissionLevel: permCheck.level,
              inputs: resolvedInputs,
              approvalReason: permCheck.reason,
              createdAt: new Date().toISOString(),
              status: 'pending',
            };

            stepResult.status = 'waiting-approval';
            stepResult.approvalRequestId = approvalRequestId;
            stepResult.error = permCheck.reason;

            run.status = 'paused_for_approval';
            run.pendingApproval = checkpoint;
            run.error = `Waiting for approval: ${permCheck.reason}`;
            await this.saveRun(run);
            return run;
          }

          stepResult.status = 'failed';
          stepResult.error = permCheck.reason;
          if (step.stopOnFailure !== false) {
            await this.runCleanupSteps(workflow, run);
            run.status = 'failed';
            run.error = `Step "${step.id}" not permitted: ${permCheck.reason}`;
            run.completedAt = new Date().toISOString();
            await this.saveRun(run);
            return run;
          }
          continue;
        }

        // Step is authorized: consume active pending approval if it matches this step
        if (run.pendingApproval && run.pendingApproval.stepId === step.id) {
          run.pendingApproval.status = 'consumed';
        }

        stepResult.status = 'running';
        stepResult.startedAt = new Date().toISOString();
        await this.saveRun(run);

        // Bounded retry policy with safe idempotency check
        const isNonIdempotent = permCheck.level === 'publish' || permCheck.level === 'destructive';
        const canRetry = Boolean(
          step.retryable &&
          (step.maxRetries ?? 0) > 0 &&
          (!isNonIdempotent || step.safeToRetry === true)
        );
        const maxAttempts = canRetry ? (step.maxRetries! + 1) : 1;
        let attempts = 0;

        while (attempts < maxAttempts) {
          attempts++;
          stepResult.attempts = attempts;

          if (controller.signal.aborted || (run.status as WorkflowRunStatus) === 'cancelled') {
            stepResult.status = 'cancelled';
            run.status = 'cancelled';
            run.error = 'Workflow run cancelled';
            await this.saveRun(run);
            return run;
          }

          try {
            let output: unknown;
            if (step.bridge.startsWith('mcp:') && this.mcpManager) {
              const serverId = step.bridge.slice(4);
              const mcpRes = await this.mcpManager.callTool(serverId, step.action, resolvedInputs);
              if (mcpRes.status === 'error') {
                throw new Error(mcpRes.error || `MCP tool "${step.action}" failed`);
              }
              if (mcpRes.status === 'blocked') {
                throw new Error(mcpRes.error || `MCP tool "${step.action}" was blocked`);
              }
              output = mcpRes.output;
            } else {
              output = await this.executor.execute(step, resolvedInputs);
            }

            stepResult.status = 'completed';
            stepResult.output = output;
            stepResult.completedAt = new Date().toISOString();
            delete stepResult.error;
            await this.saveRun(run);
            break;
          } catch (e) {
            const err = e as Error;
            const errMsg = err.message.toLowerCase();
            const isAmbiguousError =
              errMsg.includes('timeout') ||
              errMsg.includes('econnreset') ||
              errMsg.includes('etimedout') ||
              errMsg.includes('504') ||
              errMsg.includes('socket hang up');

            // Non-idempotent operations with side effects must enter reconciliation rather than blindly repeating
            const isNonIdempotent = this.isActionNonIdempotent(step.bridge, step.action);
            if (isNonIdempotent && isAmbiguousError && !step.safeToRetry) {
              stepResult.status = 'needs_reconciliation';
              stepResult.error = `Ambiguous execution failure: ${err.message}. Execution paused in reconciliation state to prevent duplicate side effects.`;
              stepResult.completedAt = new Date().toISOString();
              stepResult.reconciliation = {
                stepId: step.id,
                action: step.action,
                bridge: step.bridge,
                sideEffects: true,
                detectedAt: new Date().toISOString(),
                reason: `Ambiguous error during execution: ${err.message}`,
                error: err.message,
                inputs: resolvedInputs,
                suggestedAction: 'Verify remote provider state before retrying or marking step completed.',
                options: ['verify_remote_state', 'mark_completed', 'mark_failed', 'retry_after_verification'],
              };

              run.status = 'needs_reconciliation';
              run.error = `Workflow paused: Step "${step.id}" entered reconciliation state.`;
              run.reconciliation = stepResult.reconciliation;
              await this.saveRun(run);
              return run;
            }

            if (attempts < maxAttempts && step.retryDelayMs && step.retryDelayMs > 0) {
              await new Promise(r => setTimeout(r, step.retryDelayMs));
            }
            if (attempts >= maxAttempts) {
              stepResult.status = 'failed';
              stepResult.error = (e as Error).message;
              stepResult.completedAt = new Date().toISOString();

              if (step.stopOnFailure !== false) {
                await this.runCleanupSteps(workflow, run);
                run.status = 'failed';
                run.error = `Step "${step.id}" failed: ${stepResult.error}`;
                run.completedAt = new Date().toISOString();
                await this.saveRun(run);
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
        await this.saveRun(run);
      }

      return run;
    } finally {
      this.activeControllers.delete(run.runId);
    }
  }

  /**
   * Explicitly approve a step waiting in paused_for_approval state.
   */
  async approveStep(
    runId: string,
    approvalRequestId: string,
    decision: ApprovalDecision,
  ): Promise<WorkflowRun> {
    const run = await this.getRun(runId);
    if (!run) {
      throw new Error(`Workflow run "${runId}" not found`);
    }
    if (run.status !== 'paused_for_approval') {
      throw new Error(`Cannot approve run "${runId}": status is "${run.status}" (must be "paused_for_approval")`);
    }
    const pending = run.pendingApproval;
    if (!pending || pending.approvalRequestId !== approvalRequestId) {
      throw new Error(`Approval request "${approvalRequestId}" not found or does not match active approval on run "${runId}"`);
    }
    if (pending.status !== 'pending') {
      throw new Error(`Approval request "${approvalRequestId}" is not pending (status: ${pending.status})`);
    }

    if (!decision.approvedBy || decision.approvedBy.trim() === '') {
      throw new Error('Approval requires an explicit approvedBy user identity');
    }

    if (decision.confirmed !== true) {
      pending.status = 'rejected';
      pending.approvedBy = decision.approvedBy;
      pending.approvedAt = new Date().toISOString();
      pending.rejectionReason = decision.reason || 'Rejected by user';

      const stepResult = this.getStepResult(run, pending.stepId);
      if (stepResult) {
        stepResult.status = 'failed';
        stepResult.error = `Approval rejected: ${pending.rejectionReason}`;
      }
      run.status = 'stopped';
      run.error = `Approval rejected: ${pending.rejectionReason}`;
      await this.saveRun(run);
      return run;
    }

    if (decision.expectedInputs) {
      if (!this.matchInputs(pending.inputs, decision.expectedInputs)) {
        throw new Error('Approval rejected: provided inputs do not match pending approval inputs');
      }
    }

    // Record approval in permission manager
    this.permissions.recordApproval(
      pending.provider,
      pending.action,
      pending.permissionLevel,
      decision.approvedBy,
      decision.reason || 'Approved by user',
      pending.inputs,
    );

    pending.status = 'approved';
    pending.approvedBy = decision.approvedBy;
    pending.approvedAt = new Date().toISOString();

    const stepResult = this.getStepResult(run, pending.stepId);
    if (stepResult) {
      stepResult.status = 'approved';
      stepResult.approvedBy = decision.approvedBy;
      stepResult.approvedAt = pending.approvedAt;
      delete stepResult.error;
    }

    await this.saveRun(run);
    return run;
  }

  /**
   * Resume an approved workflow run without repeating completed steps.
   */
  async resumeRun(
    workflowOrRunId: WorkflowDefinition | string,
    runIdOrRun?: string | WorkflowRun | { signal?: AbortSignal },
    options?: { signal?: AbortSignal },
  ): Promise<WorkflowRun> {
    let workflow: WorkflowDefinition;
    let run: WorkflowRun;
    let effectiveOptions = options;

    if (typeof workflowOrRunId === 'string') {
      const foundRun = await this.getRun(workflowOrRunId);
      if (!foundRun) {
        throw new Error(`Workflow run "${workflowOrRunId}" not found`);
      }
      const foundWorkflow = this.workflows.get(foundRun.workflowId);
      if (!foundWorkflow) {
        throw new Error(`Workflow definition "${foundRun.workflowId}" not found for run "${foundRun.runId}"`);
      }
      workflow = foundWorkflow;
      run = foundRun;
      if (runIdOrRun && typeof runIdOrRun === 'object' && !('runId' in runIdOrRun)) {
        effectiveOptions = runIdOrRun as { signal?: AbortSignal };
      }
    } else {
      workflow = workflowOrRunId;
      const targetRun = typeof runIdOrRun === 'string' ? await this.getRun(runIdOrRun) : (runIdOrRun as WorkflowRun);
      if (!targetRun) {
        throw new Error('Workflow run not found');
      }
      run = targetRun;
    }

    if (run.pendingApproval) {
      if (run.pendingApproval.status === 'pending') {
        throw new Error(`Cannot resume run "${run.runId}": step "${run.pendingApproval.stepId}" is waiting for approval`);
      }
      if (run.pendingApproval.status === 'rejected') {
        throw new Error(`Cannot resume run "${run.runId}": approval was rejected`);
      }
    }

    if (run.status === 'needs_reconciliation') {
      throw new Error(`Cannot resume run "${run.runId}": run requires reconciliation before continuing. Call reconcileRun() first.`);
    }

    return this.executeRun(workflow, run, effectiveOptions);
  }

  /**
   * Reconcile a workflow run paused in needs_reconciliation state.
   */
  async reconcileRun(
    runId: string,
    decision: 'mark_completed' | 'mark_failed' | 'retry_after_verification',
    options?: {
      stepId?: string;
      resolvedBy?: string;
      notes?: string;
      outputOverride?: unknown;
    },
  ): Promise<WorkflowRun> {
    const run = await this.getRun(runId);
    if (!run) {
      throw new Error(`Workflow run "${runId}" not found`);
    }

    if (run.status !== 'needs_reconciliation') {
      throw new Error(`Workflow run "${runId}" is not in needs_reconciliation state (current: ${run.status})`);
    }

    const stepId = options?.stepId || run.reconciliation?.stepId;
    const stepResult = run.steps.find(s => s.stepId === stepId);
    if (!stepResult) {
      throw new Error(`Step "${stepId}" not found in run "${runId}"`);
    }

    const now = new Date().toISOString();
    const resolvedBy = options?.resolvedBy || 'operator';
    const notes = options?.notes || `Reconciliation decision: ${decision}`;

    if (stepResult.reconciliation) {
      stepResult.reconciliation.resolvedAt = now;
      stepResult.reconciliation.resolvedBy = resolvedBy;
      stepResult.reconciliation.resolutionDecision = decision;
      stepResult.reconciliation.resolutionNotes = notes;
    }

    if (decision === 'mark_completed') {
      stepResult.status = 'completed';
      stepResult.output = options?.outputOverride ?? { reconciled: true, notes };
      delete stepResult.error;
      delete run.reconciliation;
      run.status = 'running';
      delete run.error;
      await this.saveRun(run);

      // Continue executing remaining steps
      const workflow = this.workflows.get(run.workflowId);
      if (workflow) {
        return this.executeRun(workflow, run);
      }
      return run;
    }

    if (decision === 'mark_failed') {
      stepResult.status = 'failed';
      run.status = 'failed';
      run.error = `Reconciliation resolved as failed: ${notes}`;
      run.completedAt = now;
      await this.saveRun(run);
      return run;
    }

    if (decision === 'retry_after_verification') {
      stepResult.status = 'pending';
      delete stepResult.error;
      delete stepResult.reconciliation;
      delete run.reconciliation;
      run.status = 'running';
      delete run.error;
      await this.saveRun(run);

      const workflow = this.workflows.get(run.workflowId);
      if (workflow) {
        return this.executeRun(workflow, run);
      }
      return run;
    }

    throw new Error(`Invalid reconciliation decision "${decision}"`);
  }

  private isActionNonIdempotent(bridgeName: string, actionName: string): boolean {
    if (bridgeName.startsWith('mcp:')) {
      const serverId = bridgeName.slice(4);
      const server = this.mcpManager?.getServer(serverId);
      const tool = server?.tools.find(t => t.name === actionName);
      return tool?.sideEffects === true || tool?.permissionLevel === 'external-write' || tool?.permissionLevel === 'publish' || tool?.permissionLevel === 'destructive';
    }
    const entry = this.registry.getBridge(bridgeName);
    if (!entry) return false;
    const cap = entry.manifest.capabilities.find(c => c.action === actionName);
    return cap?.sideEffects === true || cap?.permissionLevel === 'external-write' || cap?.permissionLevel === 'publish' || cap?.permissionLevel === 'destructive';
  }

  /**
   * Cooperatively cancel a workflow run and trigger any cleanup steps.
   */
  async cancelRun(runId: string, reason = 'Cancelled by user'): Promise<WorkflowRun> {
    const controller = this.activeControllers.get(runId);
    if (controller) {
      controller.abort();
    }
    const run = await this.getRun(runId);
    if (!run) {
      throw new Error(`Workflow run "${runId}" not found`);
    }
    run.status = 'cancelled';
    run.error = reason;
    for (const s of run.steps) {
      if (s.status === 'running' || s.status === 'pending' || s.status === 'waiting-approval') {
        s.status = 'cancelled';
      }
    }
    const workflow = this.workflows.get(run.workflowId);
    if (workflow) {
      await this.runCleanupSteps(workflow, run);
    }
    run.completedAt = new Date().toISOString();
    await this.saveRun(run);
    return run;
  }

  /**
   * Execute steps marked with cleanup: true that have not yet run.
   */
  async runCleanupSteps(workflow: WorkflowDefinition, run: WorkflowRun): Promise<void> {
    const cleanupSteps = workflow.steps.filter(s => s.cleanup === true);
    for (const step of cleanupSteps) {
      let stepResult = this.getStepResult(run, step.id);
      if (stepResult && (stepResult.status === 'completed' || stepResult.status === 'running')) {
        continue;
      }
      if (!stepResult) {
        stepResult = {
          stepId: step.id,
          status: 'pending',
        };
        run.steps.push(stepResult);
      }
      stepResult.status = 'running';
      stepResult.startedAt = new Date().toISOString();
      try {
        const resolvedInputs = this.resolveStepInputs(step.inputs, run);
        stepResult.inputs = resolvedInputs;
        const output = await this.executor.execute(step, resolvedInputs);
        stepResult.status = 'completed';
        stepResult.output = output;
        stepResult.completedAt = new Date().toISOString();
      } catch (err) {
        stepResult.status = 'failed';
        stepResult.error = `Cleanup step failed: ${(err as Error).message}`;
        stepResult.completedAt = new Date().toISOString();
      }
    }
  }

  /**
   * Dry-run validate a workflow definition before execution.
   */
  async dryRun(workflow: WorkflowDefinition): Promise<WorkflowDryRunResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const steps: WorkflowDryRunStep[] = [];

    if (!workflow.steps || workflow.steps.length === 0) {
      errors.push('Workflow has no steps defined');
      return { valid: false, errors, warnings, steps };
    }

    const seenStepIds = new Set<string>();

    for (const step of workflow.steps) {
      if (!step.id) {
        errors.push('Workflow step is missing an "id"');
        continue;
      }
      if (seenStepIds.has(step.id)) {
        errors.push(`Duplicate step ID "${step.id}"`);
      }
      seenStepIds.add(step.id);

      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!seenStepIds.has(depId)) {
            errors.push(`Step "${step.id}" depends on step "${depId}" which has not been declared before it`);
          }
        }
      }

      const missingCredentials: string[] = [];
      let permLevel: PermissionLevel = 'read';
      let requiresApproval = false;
      let approvalReason: string | undefined;
      let isNonIdempotent = false;

      if (step.bridge.startsWith('mcp:')) {
        const serverId = step.bridge.slice(4);
        const server = this.mcpManager?.getServer(serverId);
        if (!server) {
          warnings.push(`MCP server "${serverId}" not currently loaded in McpManager`);
        } else {
          const tool = server.tools.find(t => t.name === step.action);
          if (!tool) {
            errors.push(`MCP tool "${step.action}" not found on server "${serverId}"`);
          } else {
            permLevel = tool.permissionLevel;
            requiresApproval = tool.requiresApproval ?? false;
            approvalReason = requiresApproval ? `MCP tool "${step.action}" requires approval` : undefined;
            isNonIdempotent = tool.sideEffects === true || permLevel === 'external-write' || permLevel === 'publish' || permLevel === 'destructive';
          }
        }
      } else {
        const bridge = this.registry.getBridge(step.bridge);
        if (!bridge) {
          errors.push(`Native bridge "${step.bridge}" not found in registry`);
        } else {
          const cap = bridge.manifest.capabilities.find(c => c.action === step.action);
          if (!cap) {
            errors.push(`Action "${step.action}" not found in bridge "${step.bridge}"`);
          } else {
            permLevel = cap.permissionLevel;
            const permRule = this.permissions.checkPermission(bridge.manifest, step.action, step.inputs);
            requiresApproval = permRule.requiresApproval;
            approvalReason = permRule.reason;
            isNonIdempotent = cap.sideEffects === true || permLevel === 'external-write' || permLevel === 'publish' || permLevel === 'destructive';
          }

          if (bridge.manifest.auth) {
            for (const authReq of bridge.manifest.auth) {
              if (authReq.envVar && authReq.required && !process.env[authReq.envVar]) {
                missingCredentials.push(authReq.envVar);
              }
            }
          }
          if (bridge.manifest.integrations) {
            for (const req of bridge.manifest.integrations) {
              if (req.check.type === 'env-var' && req.required && !process.env[req.check.value]) {
                if (!missingCredentials.includes(req.check.value)) {
                  missingCredentials.push(req.check.value);
                }
              }
            }
          }
        }
      }

      steps.push({
        stepId: step.id,
        name: step.name || step.id,
        bridge: step.bridge,
        action: step.action,
        permissionLevel: permLevel,
        requiresApproval,
        approvalReason,
        missingCredentials,
        isNonIdempotent,
        timeoutMs: step.timeoutMs || 30000,
        condition: step.condition,
        cleanup: step.cleanup,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      steps,
    };
  }

  /**
   * Persist run state with sensitive fields redacted.
   */
  async saveRun(run: WorkflowRun): Promise<void> {
    this.runs.set(run.runId, JSON.parse(JSON.stringify(run)));
    if (this.storageDir) {
      try {
        await mkdir(this.storageDir, { recursive: true });
        const safeRun = redactObject(run);
        const filePath = join(this.storageDir, `${run.runId}.json`);
        await writeFile(filePath, JSON.stringify(safeRun, null, 2), 'utf-8');
      } catch {
        // ignore disk write errors
      }
    }
  }

  /**
   * Get run by ID from in-memory cache or persisted storage.
   */
  async getRun(runId: string): Promise<WorkflowRun | undefined> {
    if (this.runs.has(runId)) {
      return this.runs.get(runId);
    }
    if (this.storageDir) {
      const filePath = join(this.storageDir, `${runId}.json`);
      if (existsSync(filePath)) {
        try {
          const raw = await readFile(filePath, 'utf-8');
          const run = JSON.parse(raw) as WorkflowRun;
          this.runs.set(run.runId, run);
          return run;
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  /**
   * List all known workflow runs.
   */
  async listRuns(): Promise<WorkflowRun[]> {
    if (this.storageDir && existsSync(this.storageDir)) {
      try {
        const files = await readdir(this.storageDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const runId = file.replace(/\.json$/, '');
            if (!this.runs.has(runId)) {
              await this.getRun(runId);
            }
          }
        }
      } catch {
        // ignore
      }
    }
    return Array.from(this.runs.values()).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  }

  /**
   * Deep equality check for inputs.
   */
  private matchInputs(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);
    if (expectedKeys.length !== actualKeys.length) {
      return false;
    }
    for (const [key, val] of Object.entries(expected)) {
      if (JSON.stringify(val) !== JSON.stringify(actual[key])) {
        return false;
      }
    }
    return true;
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
      'cancelled': '⏹',
      'needs_reconciliation': '⚠️',
    };
    return icons[status] ?? '?';
  }

  private generateId(): string {
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
