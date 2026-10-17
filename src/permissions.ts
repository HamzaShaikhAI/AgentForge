import {
  PermissionLevel,
  PermissionRule,
  PERMISSION_HIERARCHY,
  BridgeManifest,
  BridgeCapability,
} from './types.js';

export interface ApprovalRecord {
  bridge: string;
  action: string;
  level: PermissionLevel;
  approvedAt: string;
  approvedBy: string;
  reason?: string;
  inputs?: Record<string, unknown>;
}

export interface PermissionCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  level: PermissionLevel;
  reason: string;
}

/**
 * Permission manager enforces approval policies.
 * 
 * Policy tiers:
 * - read: Always allowed, no approval needed
 * - local-write: Allowed, no approval needed by default
 * - external-write: Requires explicit approval
 * - publish: Requires explicit approval, logs the decision
 * - destructive: Requires explicit approval, warns user
 */
export class PermissionManager {
  private approvals: ApprovalRecord[] = [];

  /**
   * Check whether an action is allowed under current approvals.
   * If inputs are provided, ensures approval applies to the specific action and relevant inputs.
   */
  checkPermission(
    bridge: BridgeManifest,
    action: string,
    inputs?: Record<string, unknown>,
  ): PermissionCheckResult {
    const capability = bridge.capabilities.find(c => c.action === action);
    if (!capability) {
      return {
        allowed: false,
        requiresApproval: false,
        level: 'read',
        reason: `Unknown action "${action}" on bridge "${bridge.name}"`,
      };
    }

    const level = capability.permissionLevel;
    const rule = this.findMatchingRule(bridge.permissions, action);

    // Read and local-write are allowed by default
    if (level === 'read') {
      return { allowed: true, requiresApproval: false, level, reason: 'Read operations are always allowed' };
    }

    if (level === 'local-write' && (!rule || !rule.requiresApproval)) {
      return { allowed: true, requiresApproval: false, level, reason: 'Local writes are allowed by default' };
    }

    // Check if we have a prior matching approval
    const existingApproval = this.approvals.find(a => {
      if (a.bridge !== bridge.name || a.action !== action) return false;
      // If the approval record was bound to specific inputs, verify match
      if (a.inputs !== undefined) {
        if (!inputs) return false;
        return this.matchInputs(a.inputs, inputs);
      }
      return true;
    });

    if (existingApproval) {
      return {
        allowed: true,
        requiresApproval: false,
        level,
        reason: `Previously approved at ${existingApproval.approvedAt}${existingApproval.inputs ? ' for matching inputs' : ''}`,
      };
    }

    // Needs approval
    const reasons: Record<PermissionLevel, string> = {
      'read': '',
      'local-write': 'Local write operations require approval per bridge policy',
      'external-write': 'External write operations require explicit approval',
      'publish': 'Publishing operations require explicit approval — this will be visible externally',
      'destructive': 'DESTRUCTIVE operation — this cannot be undone. Explicit approval required.',
    };

    return {
      allowed: false,
      requiresApproval: true,
      level,
      reason: rule?.approvalReason || reasons[level],
    };
  }

  /**
   * Record an approval decision, optionally binding it to specific inputs.
   */
  recordApproval(
    bridge: string,
    action: string,
    level: PermissionLevel,
    approvedBy: string = 'user',
    reason?: string,
    inputs?: Record<string, unknown>,
  ): ApprovalRecord {
    const record: ApprovalRecord = {
      bridge,
      action,
      level,
      approvedAt: new Date().toISOString(),
      approvedBy,
      reason,
      inputs: inputs ? JSON.parse(JSON.stringify(inputs)) : undefined,
    };
    this.approvals.push(record);
    return record;
  }

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
   * Get all approval records (never includes secrets).
   */
  getApprovals(): readonly ApprovalRecord[] {
    return [...this.approvals];
  }

  /**
   * Clear all approvals (e.g., for a new session).
   */
  clearApprovals(): void {
    this.approvals = [];
  }

  /**
   * Check if a permission level requires approval by default.
   */
  static requiresApprovalByDefault(level: PermissionLevel): boolean {
    const idx = PERMISSION_HIERARCHY.indexOf(level);
    // external-write and above require approval
    return idx >= 2;
  }

  /**
   * Compare two permission levels.
   * Returns negative if a < b, 0 if equal, positive if a > b.
   */
  static compareLevel(a: PermissionLevel, b: PermissionLevel): number {
    return PERMISSION_HIERARCHY.indexOf(a) - PERMISSION_HIERARCHY.indexOf(b);
  }

  private findMatchingRule(
    rules: PermissionRule[],
    action: string,
  ): PermissionRule | undefined {
    // Find the most specific matching rule
    return rules.find(rule => {
      if (rule.actions === '*') return true;
      // Simple glob: support '*' as wildcard
      const pattern = rule.actions
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      return new RegExp(`^${pattern}$`).test(action);
    });
  }
}
