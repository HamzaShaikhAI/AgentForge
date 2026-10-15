import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionManager } from './permissions.js';
import { BridgeManifest } from './types.js';

const mockBridge: BridgeManifest = {
  schema: '1.0',
  name: 'test-bridge',
  displayName: 'Test',
  description: 'Test bridge',
  version: '1.0.0',
  capabilities: [
    { action: 'read-data', description: 'Read', permissionLevel: 'read', sideEffects: false },
    { action: 'write-local', description: 'Write local', permissionLevel: 'local-write', sideEffects: true },
    { action: 'push-remote', description: 'Push', permissionLevel: 'external-write', sideEffects: true },
    { action: 'publish-release', description: 'Publish', permissionLevel: 'publish', sideEffects: true },
    { action: 'delete-all', description: 'Delete', permissionLevel: 'destructive', sideEffects: true },
  ],
  integrations: [],
  auth: [],
  permissions: [
    { actions: 'read-data', level: 'read', requiresApproval: false },
    { actions: 'write-local', level: 'local-write', requiresApproval: false },
    { actions: 'push-remote', level: 'external-write', requiresApproval: true, approvalReason: 'Will push to remote' },
    { actions: 'publish-release', level: 'publish', requiresApproval: true },
    { actions: 'delete-all', level: 'destructive', requiresApproval: true, approvalReason: 'This is destructive!' },
  ],
};

describe('PermissionManager', () => {
  let pm: PermissionManager;

  beforeEach(() => {
    pm = new PermissionManager();
  });

  it('allows read operations without approval', () => {
    const result = pm.checkPermission(mockBridge, 'read-data');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('allows local-write by default', () => {
    const result = pm.checkPermission(mockBridge, 'write-local');
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('requires approval for external-write', () => {
    const result = pm.checkPermission(mockBridge, 'push-remote');
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.reason).toContain('push to remote');
  });

  it('requires approval for publish', () => {
    const result = pm.checkPermission(mockBridge, 'publish-release');
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('requires approval for destructive operations', () => {
    const result = pm.checkPermission(mockBridge, 'delete-all');
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.reason).toContain('destructive');
  });

  it('returns not-allowed for unknown actions', () => {
    const result = pm.checkPermission(mockBridge, 'unknown-action');
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(false);
  });

  it('allows after recording approval', () => {
    const before = pm.checkPermission(mockBridge, 'push-remote');
    expect(before.allowed).toBe(false);

    pm.recordApproval('test-bridge', 'push-remote', 'external-write');

    const after = pm.checkPermission(mockBridge, 'push-remote');
    expect(after.allowed).toBe(true);
    expect(after.reason).toContain('Previously approved');
  });

  it('records and retrieves approvals', () => {
    pm.recordApproval('test-bridge', 'push-remote', 'external-write', 'user', 'Testing');
    const approvals = pm.getApprovals();
    expect(approvals).toHaveLength(1);
    expect(approvals[0].bridge).toBe('test-bridge');
    expect(approvals[0].action).toBe('push-remote');
    expect(approvals[0].reason).toBe('Testing');
  });

  it('clears approvals', () => {
    pm.recordApproval('test-bridge', 'push-remote', 'external-write');
    expect(pm.getApprovals()).toHaveLength(1);
    pm.clearApprovals();
    expect(pm.getApprovals()).toHaveLength(0);
  });

  it('static: requiresApprovalByDefault', () => {
    expect(PermissionManager.requiresApprovalByDefault('read')).toBe(false);
    expect(PermissionManager.requiresApprovalByDefault('local-write')).toBe(false);
    expect(PermissionManager.requiresApprovalByDefault('external-write')).toBe(true);
    expect(PermissionManager.requiresApprovalByDefault('publish')).toBe(true);
    expect(PermissionManager.requiresApprovalByDefault('destructive')).toBe(true);
  });

  it('static: compareLevel', () => {
    expect(PermissionManager.compareLevel('read', 'destructive')).toBeLessThan(0);
    expect(PermissionManager.compareLevel('destructive', 'read')).toBeGreaterThan(0);
    expect(PermissionManager.compareLevel('publish', 'publish')).toBe(0);
  });
});
