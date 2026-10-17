import { WorkflowDefinition, WorkflowRun, WorkflowStep, StepResult } from '../types.js';
import { WorkflowEngine } from '../workflow-engine.js';

export interface DebugBreakpoint {
  stepId: string;
  enabled: boolean;
  hitCount: number;
}

export interface DebugSessionState {
  sessionId: string;
  workflowId: string;
  runId: string;
  status: 'idle' | 'paused' | 'running' | 'completed' | 'failed';
  currentStepId?: string;
  currentStepIndex: number;
  totalSteps: number;
  breakpoints: DebugBreakpoint[];
  stepInputs?: Record<string, unknown>;
  stepResults: StepResult[];
}

export type DebugEventHandler = (event: string, state: DebugSessionState) => void;

/**
 * Interactive Workflow Step Debugger for AgentForge.
 * Enables breakpoints, step-by-step single stepping, input mutation,
 * and state inspection during workflow execution.
 */
export class WorkflowStepDebugger {
  private engine: WorkflowEngine;
  private breakpoints = new Map<string, DebugBreakpoint>();
  private listeners: DebugEventHandler[] = [];
  private pausedPromiseResolve?: () => void;
  private sessionState?: DebugSessionState;
  private isSingleStepping = false;
  private inputOverrides = new Map<string, Record<string, unknown>>();

  constructor(engine: WorkflowEngine) {
    this.engine = engine;
  }

  /**
   * Set a breakpoint on a step.
   */
  setBreakpoint(stepId: string): void {
    const existing = this.breakpoints.get(stepId);
    if (existing) {
      existing.enabled = true;
    } else {
      this.breakpoints.set(stepId, { stepId, enabled: true, hitCount: 0 });
    }
  }

  /**
   * Remove a breakpoint.
   */
  clearBreakpoint(stepId: string): boolean {
    return this.breakpoints.delete(stepId);
  }

  /**
   * Clear all breakpoints.
   */
  clearAllBreakpoints(): void {
    this.breakpoints.clear();
  }

  /**
   * Listen for debugger events: 'breakpoint', 'step-completed', 'session-resumed', 'completed'.
   */
  onEvent(handler: DebugEventHandler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter(l => l !== handler);
    };
  }

  private emit(event: string): void {
    if (this.sessionState) {
      for (const handler of this.listeners) {
        try {
          handler(event, { ...this.sessionState });
        } catch {
          // ignore listener errors
        }
      }
    }
  }

  /**
   * Mutate inputs for a pending/paused step before execution.
   */
  mutateStepInputs(stepId: string, inputs: Record<string, unknown>): void {
    this.inputOverrides.set(stepId, inputs);
    if (this.sessionState && this.sessionState.currentStepId === stepId) {
      this.sessionState.stepInputs = { ...inputs };
    }
  }

  /**
   * Get current debug session state.
   */
  getState(): DebugSessionState | undefined {
    return this.sessionState ? { ...this.sessionState } : undefined;
  }

  /**
   * Start a debug session for a workflow.
   */
  async startDebugSession(
    workflow: WorkflowDefinition,
    initialInputs: Record<string, unknown> = {},
  ): Promise<WorkflowRun> {
    const run = this.engine.createRun(workflow);
    if (initialInputs && Object.keys(initialInputs).length > 0 && workflow.steps.length > 0) {
      workflow.steps[0].inputs = { ...workflow.steps[0].inputs, ...initialInputs };
    }

    this.sessionState = {
      sessionId: `dbg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      workflowId: workflow.id,
      runId: run.runId,
      status: 'running',
      currentStepIndex: 0,
      totalSteps: workflow.steps.length,
      breakpoints: Array.from(this.breakpoints.values()),
      stepResults: run.steps,
    };

    // Evaluate breakpoints and allow step mutation before executing
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      this.sessionState.currentStepId = step.id;
      this.sessionState.currentStepIndex = i;

      // Check for input overrides
      const overriddenInputs = this.inputOverrides.get(step.id);
      if (overriddenInputs) {
        step.inputs = { ...step.inputs, ...overriddenInputs };
      }

      // Check breakpoint or single-step mode
      const bp = this.breakpoints.get(step.id);
      const shouldPause = (bp && bp.enabled) || this.isSingleStepping;

      if (shouldPause) {
        if (bp) {
          bp.hitCount++;
        }
        this.sessionState.status = 'paused';
        this.sessionState.stepInputs = step.inputs;

        // Wait until resumed or stepped
        await new Promise<void>(resolve => {
          this.pausedPromiseResolve = resolve;
          queueMicrotask(() => this.emit('breakpoint'));
        });
      }

      this.sessionState.status = 'running';
      this.sessionState.stepResults = run.steps;
    }

    // Execute run with all mutated inputs and breakpoint passes
    await this.engine.executeRun(workflow, run);

    this.sessionState.status = run.status === 'completed' ? 'completed' : 'failed';
    this.sessionState.stepResults = run.steps;
    this.emit('completed');
    return run;
  }

  /**
   * Resume execution until next breakpoint or completion.
   */
  resume(): void {
    this.isSingleStepping = false;
    if (this.pausedPromiseResolve) {
      const resolve = this.pausedPromiseResolve;
      this.pausedPromiseResolve = undefined;
      resolve();
      this.emit('session-resumed');
    }
  }

  /**
   * Step over the current step and pause at the next one.
   */
  stepOver(): void {
    this.isSingleStepping = true;
    if (this.pausedPromiseResolve) {
      const resolve = this.pausedPromiseResolve;
      this.pausedPromiseResolve = undefined;
      resolve();
      this.emit('step-completed');
    }
  }
}
