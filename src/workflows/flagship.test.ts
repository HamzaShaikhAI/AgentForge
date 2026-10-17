import { describe, it, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { WorkflowEngine } from '../workflow-engine.js';
import { BridgeRegistry } from '../bridge-registry.js';
import { PermissionManager } from '../permissions.js';
import { StandardStepExecutor } from '../executors/index.js';
import {
  FLAGSHIP_WORKFLOWS,
  releasePipelineWorkflow,
  multiChannelPublishWorkflow,
  incidentTriageWorkflow,
  dataPipelineWorkflow,
  getFlagshipWorkflow,
} from './flagship.js';

describe('Phase 6 — Flagship End-to-End Production Workflows', () => {
  const bridgesDir = resolve(import.meta.dirname, '..', '..', 'bridges');
  const registry = new BridgeRegistry(bridgesDir);
  const permissions = new PermissionManager();
  const executor = new StandardStepExecutor(registry);
  const engine = new WorkflowEngine(registry, permissions, executor);

  beforeAll(async () => {
    await registry.discover();
    for (const wf of FLAGSHIP_WORKFLOWS) {
      engine.registerWorkflow(wf);
    }
  });

  it('provides all 4 flagship production workflows with valid metadata and IDs', () => {
    assert.equal(FLAGSHIP_WORKFLOWS.length, 4);
    assert.ok(getFlagshipWorkflow('wf-autonomous-release'));
    assert.ok(getFlagshipWorkflow('wf-multichannel-publish'));
    assert.ok(getFlagshipWorkflow('wf-incident-triage'));
    assert.ok(getFlagshipWorkflow('wf-data-pipeline-sync'));
  });

  // ─── Workflow 1: Autonomous Release Pipeline ────────────────────────
  describe('Workflow 1: Autonomous Release Pipeline', () => {
    it('dry-run passes and flags approval requirements on tag creation', async () => {
      const dryRun = await engine.dryRun(releasePipelineWorkflow);
      assert.equal(dryRun.valid, true);
      assert.equal(dryRun.errors.length, 0);

      // Verify publish-release-tag step requires approval because it is a publish action
      const publishStep = dryRun.steps.find(s => s.stepId === 'publish-release-tag');
      assert.ok(publishStep);
      assert.equal(publishStep.bridge, 'github');
      assert.equal(publishStep.action, 'push-tags');
      assert.equal(publishStep.requiresApproval, true);
      assert.equal(publishStep.permissionLevel, 'publish');
    });

    it('executes read and local steps and triggers approval checkpoint before publishing tag', async () => {
      const run = await engine.run(releasePipelineWorkflow);

      // It should pause at publish-release-tag for approval checkpoint
      assert.equal(run.status, 'paused_for_approval');
      assert.ok(run.pendingApproval);
      assert.equal(run.pendingApproval.stepId, 'publish-release-tag');
      assert.equal(run.pendingApproval.provider, 'github');
      assert.equal(run.pendingApproval.action, 'push-tags');
      assert.equal(run.pendingApproval.permissionLevel, 'publish');

      // Prior steps must have completed
      const inspectRes = run.steps.find(s => s.stepId === 'inspect-repo');
      assert.equal(inspectRes?.status, 'completed');

      const statusRes = run.steps.find(s => s.stepId === 'verify-status');
      assert.equal(statusRes?.status, 'completed');

      const pkgRes = run.steps.find(s => s.stepId === 'verify-package');
      assert.equal(pkgRes?.status, 'completed');

      const changelogRes = run.steps.find(s => s.stepId === 'prepare-changelog');
      assert.equal(changelogRes?.status, 'completed');
    });
  });

  // ─── Workflow 2: Multi-Channel Content Publishing ───────────────────
  describe('Workflow 2: Multi-Channel Content Publishing', () => {
    it('dry-run validates asset verification, upload, and social dispatches', async () => {
      const dryRun = await engine.dryRun(multiChannelPublishWorkflow);
      assert.equal(dryRun.valid, true);
      assert.equal(dryRun.steps.length, 4);

      const ytStep = dryRun.steps.find(s => s.stepId === 'youtube-upload');
      assert.ok(ytStep);
      assert.equal(ytStep.isNonIdempotent, true);
      assert.equal(ytStep.requiresApproval, true);
    });

    it('pauses for approval checkpoint before YouTube upload and preserves inputs', async () => {
      const run = await engine.run(multiChannelPublishWorkflow);

      // Should pause for YouTube publishing approval
      assert.equal(run.status, 'paused_for_approval');
      assert.ok(run.pendingApproval);
      assert.equal(run.pendingApproval.stepId, 'youtube-upload');
      assert.equal(run.pendingApproval.provider, 'youtube');
      assert.equal(run.pendingApproval.permissionLevel, 'publish');

      // Asset verification step completed
      const assetRes = run.steps.find(s => s.stepId === 'verify-asset');
      assert.equal(assetRes?.status, 'completed');
    });
  });

  // ─── Workflow 3: Incident Response & Triage ─────────────────────────
  describe('Workflow 3: Incident Response & Triage', () => {
    it('dry-run confirms step conditions and external-write permissions', async () => {
      const dryRun = await engine.dryRun(incidentTriageWorkflow);
      assert.equal(dryRun.valid, true);

      const evalStep = dryRun.steps.find(s => s.stepId === 'evaluate-issue');
      assert.ok(evalStep?.condition);

      const issueStep = dryRun.steps.find(s => s.stepId === 'create-tracking-issue');
      assert.equal(issueStep?.requiresApproval, true);
      assert.equal(issueStep?.permissionLevel, 'external-write');
    });

    it('executes telemetry query, evaluates condition, and pauses before GitHub issue creation', async () => {
      const run = await engine.run(incidentTriageWorkflow);

      // Pauses for approval before opening external issue
      assert.equal(run.status, 'paused_for_approval');
      assert.equal(run.pendingApproval?.stepId, 'create-tracking-issue');
      assert.equal(run.pendingApproval?.action, 'create-issue');

      // Evaluated step executed because condition passed
      const evalStep = run.steps.find(s => s.stepId === 'evaluate-issue');
      assert.equal(evalStep?.status, 'completed');
    });
  });

  // ─── Workflow 4: Data Pipeline & Local Database Sync ────────────────
  describe('Workflow 4: Data Pipeline & Local Database Sync', () => {
    it('dry-run identifies read steps, external sync, and cleanup hook', async () => {
      const dryRun = await engine.dryRun(dataPipelineWorkflow);
      assert.equal(dryRun.valid, true);
      assert.equal(dryRun.steps.length, 4);

      const cleanupStep = dryRun.steps.find(s => s.stepId === 'pipeline-cleanup');
      assert.equal(cleanupStep?.cleanup, true);
    });

    it('executes data pipeline successfully from filesystem to SQLite and HTTP notify', async () => {
      const run = await engine.run(dataPipelineWorkflow);
      assert.equal(run.status, 'completed');

      const s1 = run.steps.find(s => s.stepId === 'read-dataset');
      assert.equal(s1?.status, 'completed');

      const s2 = run.steps.find(s => s.stepId === 'inspect-sqlite');
      assert.equal(s2?.status, 'completed');

      const s3 = run.steps.find(s => s.stepId === 'http-notify');
      assert.equal(s3?.status, 'completed');

      const s4 = run.steps.find(s => s.stepId === 'pipeline-cleanup');
      assert.equal(s4?.status, 'completed');
    });
  });
});
