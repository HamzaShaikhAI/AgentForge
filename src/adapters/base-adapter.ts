import { PermissionLevel } from '../types.js';

export interface AdapterHealthResult {
  healthy: boolean;
  status: 'available' | 'configured' | 'unconfigured' | 'error' | 'connected';
  message: string;
  details?: Record<string, unknown>;
}

export interface AdapterActionDefinition {
  action: string;
  description: string;
  permissionLevel: PermissionLevel;
  sideEffects: boolean;
  requiresApproval: boolean;
  inputSchema?: Record<string, unknown>;
}

/**
 * Standardized Contract for Native AgentForge Adapters (Phase 4).
 * Enforces:
 * - Deterministic health check diagnostics
 * - Strongly-typed action metadata, permissions, and side-effect declarations
 * - Point-of-execution input validation
 * - Output secret redaction and error sanitization
 */
export abstract class BaseIntegrationAdapter {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly description: string;
  abstract readonly version: string;
  abstract readonly category: string;

  /**
   * Return all actions supported by this adapter with explicit permission levels.
   */
  abstract getActions(): AdapterActionDefinition[];

  /**
   * Truthful health check inspecting local dependencies, configuration, or connectivity.
   */
  abstract checkHealth(): Promise<AdapterHealthResult>;

  /**
   * Execute a declared action with input validation and execution isolation.
   */
  abstract execute(action: string, inputs: Record<string, unknown>): Promise<unknown>;

  /**
   * Lookup metadata for a specific action.
   */
  getAction(actionName: string): AdapterActionDefinition | undefined {
    return this.getActions().find(a => a.action === actionName);
  }

  /**
   * Determine if an action has side effects or non-idempotent semantics.
   */
  isNonIdempotent(actionName: string): boolean {
    const action = this.getAction(actionName);
    if (!action) return false;
    return (
      action.sideEffects === true ||
      action.permissionLevel === 'publish' ||
      action.permissionLevel === 'destructive' ||
      action.permissionLevel === 'external-write'
    );
  }
}
