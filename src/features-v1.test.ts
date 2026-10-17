import { describe, it, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { WorkflowEngine } from './workflow-engine.js';
import { BridgeRegistry } from './bridge-registry.js';
import { PermissionManager } from './permissions.js';
import { StandardStepExecutor } from './executors/index.js';
import { WorkflowDefinition } from './types.js';

// Feature Modules
import { AuditChain, GENESIS_PREVIOUS_HASH } from './audit/audit-chain.js';
import { WebhookIngress } from './triggers/webhook-ingress.js';
import { RateLimiter } from './governance/rate-limiter.js';
import { DelegationTokenService } from './governance/delegation-tokens.js';
import { VaultBackupService } from './auth/vault-backup.js';
import { AdapterHealthMonitor } from './adapters/health-monitor.js';
import { WorkflowStepDebugger } from './debugger/step-debugger.js';
import { AntigravitySkillGenerator } from './antigravity/skill-generator.js';
import { RunArtifactsService } from './audit/run-artifacts.js';
import { FilesystemAdapter } from './adapters/filesystem-adapter.js';

import { resolve } from 'node:path';

describe('AgentForge V1 — 15 Product Features Acceptance Tests', () => {
  // Setup standard test environment
  const bridgesDir = resolve(import.meta.dirname, '..', 'bridges');
  const registry = new BridgeRegistry(bridgesDir);
  const permissions = new PermissionManager();
  const executor = new StandardStepExecutor(registry);
  const engine = new WorkflowEngine(registry, permissions, executor);

  beforeAll(async () => {
    await registry.discover();
  });

  // ─── Feature 1: Dynamic Workflow Step Conditions ────────────────────
  describe('Feature 1: Dynamic Workflow Step Conditions', () => {
    it('evaluates comparison conditions and skips step when condition is false', async () => {
      const workflow: WorkflowDefinition = {
        id: 'condition-test-wf',
        name: 'Condition Test Workflow',
        steps: [
          {
            id: 'step1',
            bridge: 'filesystem',
            action: 'read-file',
            inputs: { path: 'package.json' },
          },
          {
            id: 'step2_should_skip',
            bridge: 'filesystem',
            action: 'read-file',
            condition: "steps.step1.status == 'failed'",
            inputs: { path: 'package.json' },
          },
          {
            id: 'step3_should_run',
            bridge: 'filesystem',
            action: 'read-file',
            condition: "steps.step1.status == 'completed'",
            inputs: { path: 'package.json' },
          },
        ],
      };

      const run = await engine.run(workflow);
      assert.equal(run.status, 'completed');

      const s1 = run.steps.find(s => s.stepId === 'step1');
      assert.equal(s1?.status, 'completed');

      const s2 = run.steps.find(s => s.stepId === 'step2_should_skip');
      assert.equal(s2?.status, 'skipped');
      assert.match(s2?.error || '', /Condition evaluated to false/);

      const s3 = run.steps.find(s => s.stepId === 'step3_should_run');
      assert.equal(s3?.status, 'completed');
    });

    it('evaluates negation, truthy values, and numeric comparisons', () => {
      const mockRun: any = {
        steps: [
          { stepId: 'stepA', status: 'completed', output: { count: 10, flag: false, name: 'agentforge' } },
        ],
      };

      assert.equal(engine.evaluateCondition('steps.stepA.output.count > 5', mockRun), true);
      assert.equal(engine.evaluateCondition('steps.stepA.output.count < 5', mockRun), false);
      assert.equal(engine.evaluateCondition('!steps.stepA.output.flag', mockRun), true);
      assert.equal(engine.evaluateCondition("steps.stepA.output.name == 'agentforge'", mockRun), true);
      assert.equal(engine.evaluateCondition("steps.stepA.output.name != 'other'", mockRun), true);
    });
  });

  // ─── Feature 2: Output Transformation & Filters ─────────────────────
  describe('Feature 2: Output Transformation & Filters', () => {
    it('applies upper, lower, trim, length, and json filters in resolveStepInputs', () => {
      const mockRun: any = {
        steps: [
          {
            stepId: 'dataStep',
            status: 'completed',
            output: {
              rawText: '   hello world   ',
              items: ['alpha', 'beta', 'gamma'],
              metadata: { version: '1.0.0', active: true },
            },
          },
        ],
      };

      const resolved = engine.resolveStepInputs(
        {
          upperText: '{{steps.dataStep.output.rawText | trim | upper}}',
          lowerText: '{{steps.dataStep.output.rawText | trim | lower}}',
          itemCount: '$steps.dataStep.output.items | length',
          jsonMeta: '$steps.dataStep.output.metadata | json',
        },
        mockRun,
      );

      assert.equal(resolved.upperText, 'HELLO WORLD');
      assert.equal(resolved.lowerText, 'hello world');
      assert.equal(resolved.itemCount, 3);
      assert.equal(resolved.jsonMeta, '{"version":"1.0.0","active":true}');
    });
  });

  // ─── Feature 3: Workflow Environment Variables Interpolation ────────
  describe('Feature 3: Workflow Environment Variables Interpolation', () => {
    it('interpolates ${env:VAR} and {{env.VAR}} from process.env', () => {
      process.env.AGENTFORGE_TEST_ENV = 'secret_test_value';
      process.env.AGENTFORGE_APP_NAME = 'AgentForgeV1';

      const mockRun: any = { steps: [] };
      const resolved = engine.resolveStepInputs(
        {
          param1: 'Prefix-${env:AGENTFORGE_TEST_ENV}',
          param2: 'App is {{env.AGENTFORGE_APP_NAME}}',
          param3: 'Default-{{env.NON_EXISTENT_VAR_XYZ}}',
        },
        mockRun,
      );

      assert.equal(resolved.param1, 'Prefix-secret_test_value');
      assert.equal(resolved.param2, 'App is AgentForgeV1');
      assert.equal(resolved.param3, 'Default-');

      delete process.env.AGENTFORGE_TEST_ENV;
      delete process.env.AGENTFORGE_APP_NAME;
    });
  });

  // ─── Feature 4: Workflow Step Timeout Override ──────────────────────
  describe('Feature 4: Workflow Step Timeout Override', () => {
    it('enforces step timeoutMs at execution level', async () => {
      const customExecutor = {
        async execute(step: any) {
          if (step.timeoutMs && step.timeoutMs < 50) {
            await new Promise(r => setTimeout(r, 100));
            throw new Error(`Step timed out after ${step.timeoutMs}ms`);
          }
          return { ok: true };
        },
      };

      const testEngine = new WorkflowEngine(registry, permissions, customExecutor);
      const workflow: WorkflowDefinition = {
        id: 'timeout-wf',
        name: 'Timeout Workflow',
        steps: [
          {
            id: 'slow-step',
            bridge: 'filesystem',
            action: 'read-file',
            inputs: { path: 'package.json' },
            timeoutMs: 20,
          },
        ],
      };

      const run = await testEngine.run(workflow);
      assert.equal(run.status, 'failed');
      assert.match(run.error || '', /timed out/);
    });
  });

  // ─── Feature 5: Workflow Step Compensation / Cancellation Hooks ─────
  describe('Feature 5: Workflow Step Cancellation / Compensation Hooks', () => {
    it('runs steps marked with cleanup: true when a workflow run is cancelled', async () => {
      let cleanupRan = false;

      const customExecutor = {
        async execute(step: any) {
          if (step.id === 'cleanup-step') {
            cleanupRan = true;
            return { cleaned: true };
          }
          return { ok: true };
        },
      };

      const testEngine = new WorkflowEngine(registry, permissions, customExecutor);
      const workflow: WorkflowDefinition = {
        id: 'cancellation-cleanup-wf',
        name: 'Cancellation Cleanup Workflow',
        steps: [
          {
            id: 'step1',
            bridge: 'custom',
            action: 'work',
            inputs: {},
          },
          {
            id: 'cleanup-step',
            bridge: 'custom',
            action: 'cleanup',
            cleanup: true,
            inputs: {},
          },
        ],
      };

      testEngine.registerWorkflow(workflow);
      const run = testEngine.createRun(workflow);
      await testEngine.cancelRun(run.runId, 'Operator aborted job');

      assert.equal(run.status, 'cancelled');
      assert.equal(cleanupRan, true);

      const cleanupStepResult = run.steps.find(s => s.stepId === 'cleanup-step');
      assert.equal(cleanupStepResult?.status, 'completed');
    });

    it('runs cleanup steps when a workflow step fails with stopOnFailure', async () => {
      let cleanupRan = false;

      const customExecutor = {
        async execute(step: any) {
          if (step.id === 'failing-step') {
            throw new Error('Task crashed unexpectedly');
          }
          if (step.id === 'cleanup-after-failure') {
            cleanupRan = true;
            return { rollback: true };
          }
          return {};
        },
      };

      const testEngine = new WorkflowEngine(registry, permissions, customExecutor);
      const workflow: WorkflowDefinition = {
        id: 'failure-cleanup-wf',
        name: 'Failure Cleanup Workflow',
        steps: [
          {
            id: 'failing-step',
            bridge: 'filesystem',
            action: 'read-file',
            inputs: { path: 'package.json' },
            stopOnFailure: true,
          },
          {
            id: 'cleanup-after-failure',
            bridge: 'filesystem',
            action: 'write-file',
            cleanup: true,
            inputs: { path: 'tmp.txt', content: 'test' },
          },
        ],
      };

      const run = await testEngine.run(workflow);
      assert.equal(run.status, 'failed');
      assert.equal(cleanupRan, true);

      const cleanupStep = run.steps.find(s => s.stepId === 'cleanup-after-failure');
      assert.equal(cleanupStep?.status, 'completed');
    });
  });

  // ─── Feature 6: Workflow Dry-Run Mode ───────────────────────────────
  describe('Feature 6: Workflow Dry-Run Mode', () => {
    it('validates workflow DAG, action existence, permissions, and idempotency without executing', async () => {
      const validWorkflow: WorkflowDefinition = {
        id: 'dryrun-test-wf',
        name: 'Dry-Run Test Workflow',
        steps: [
          {
            id: 'readStep',
            bridge: 'filesystem',
            action: 'read-file',
            inputs: { path: 'package.json' },
          },
          {
            id: 'writeStep',
            bridge: 'filesystem',
            action: 'write-file',
            dependsOn: ['readStep'],
            inputs: { path: 'tmp.txt', content: 'test' },
          },
        ],
      };

      const result = await engine.dryRun(validWorkflow);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
      assert.equal(result.steps.length, 2);

      const s1 = result.steps[0];
      assert.equal(s1.stepId, 'readStep');
      assert.equal(s1.permissionLevel, 'read');
      assert.equal(s1.isNonIdempotent, false);

      const s2 = result.steps[1];
      assert.equal(s2.stepId, 'writeStep');
      assert.equal(s2.permissionLevel, 'local-write');
    });

    it('detects missing bridges, invalid actions, and broken dependencies during dryRun', async () => {
      const invalidWorkflow: WorkflowDefinition = {
        id: 'broken-dryrun-wf',
        name: 'Broken Dry-Run',
        steps: [
          {
            id: 'stepA',
            bridge: 'non_existent_bridge',
            action: 'fake_action',
            dependsOn: ['step_that_does_not_exist'],
            inputs: {},
          },
        ],
      };

      const result = await engine.dryRun(invalidWorkflow);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('depends on step "step_that_does_not_exist"')));
      assert.ok(result.errors.some(e => e.includes('Native bridge "non_existent_bridge" not found')));
    });
  });

  // ─── Feature 7: Cryptographic Hash-Chain Audit Log ──────────────────
  describe('Feature 7: Cryptographic Hash-Chain Audit Log', () => {
    it('constructs a verifiable SHA-256 hash chain with genesis block and checks integrity', () => {
      const chain = new AuditChain();

      const block0 = chain.append('permission.grant', 'operator', { bridge: 'git', level: 'external-write' });
      assert.equal(block0.index, 0);
      assert.equal(block0.previousHash, GENESIS_PREVIOUS_HASH);
      assert.ok(block0.hash.length === 64);

      const block1 = chain.append('workflow.execute', 'system', { workflowId: 'release-v1' });
      assert.equal(block1.index, 1);
      assert.equal(block1.previousHash, block0.hash);

      const block2 = chain.append('oauth.authenticated', 'operator', { provider: 'google', email: 'user@example.com' });
      assert.equal(block2.index, 2);
      assert.equal(block2.previousHash, block1.hash);

      const verifyRes = chain.verifyIntegrity();
      assert.equal(verifyRes.valid, true);
      assert.equal(verifyRes.totalBlocks, 3);
    });

    it('detects tampering when an audit block data or hash is manipulated', () => {
      const chain = new AuditChain();
      chain.append('event1', 'userA', { count: 1 });
      chain.append('event2', 'userB', { count: 2 });
      chain.append('event3', 'userC', { count: 3 });

      // Simulate malicious tampering with block 1 payload
      const entries = chain.getEntries();
      entries[1].details = { count: 999 }; // altered payload without updating hash

      const tamperedChain = new AuditChain(entries);
      const check = tamperedChain.verifyIntegrity();
      assert.equal(check.valid, false);
      assert.equal(check.compromisedIndex, 1);
      assert.match(check.reason || '', /Tampered block data at index 1/);
    });

    it('supports query filtering, JSON export and import', () => {
      const chain = new AuditChain();
      chain.append('step.start', 'worker1', { stepId: 'stepA' });
      chain.append('step.end', 'worker1', { stepId: 'stepA' });
      chain.append('step.start', 'worker2', { stepId: 'stepB' });

      const filtered = chain.query({ actor: 'worker2' });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].details.stepId, 'stepB');

      const jsonStr = chain.exportJson();
      const newChain = new AuditChain();
      const importRes = newChain.importJson(jsonStr);
      assert.equal(importRes.valid, true);
      assert.equal(importRes.imported, 3);
      assert.equal(newChain.verifyIntegrity().valid, true);
    });
  });

  // ─── Feature 8: Webhook Ingress Trigger ─────────────────────────────
  describe('Feature 8: Webhook Ingress Trigger', () => {
    it('validates timing-safe HMAC-SHA256 signature and accepts valid payload', async () => {
      const ingress = new WebhookIngress();
      const secret = 'super_secret_webhook_key_123';
      ingress.registerEndpoint({
        endpointId: 'github-webhook',
        path: '/webhooks/github',
        secret,
        workflowId: 'dummy-wf',
      });

      const body = JSON.stringify({ action: 'push', ref: 'refs/heads/main' });
      const hmac = createHmac('sha256', secret).update(body).digest('hex');

      const res = await ingress.handleWebhook(
        '/webhooks/github',
        { 'x-hub-signature-256': `sha256=${hmac}` },
        body,
      );

      assert.equal(res.success, true);
      assert.equal(res.statusCode, 200);
    });

    it('rejects invalid or missing HMAC signatures with 401 or 403', async () => {
      const ingress = new WebhookIngress();
      ingress.registerEndpoint({
        endpointId: 'test-endpoint',
        path: '/hook',
        secret: 'key1',
        workflowId: 'wf1',
      });

      const body = '{"hello":"world"}';

      // Missing signature
      const resMissing = await ingress.handleWebhook('/hook', {}, body);
      assert.equal(resMissing.success, false);
      assert.equal(resMissing.statusCode, 401);

      // Wrong signature
      const resWrong = await ingress.handleWebhook(
        '/hook',
        { 'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' },
        body,
      );
      assert.equal(resWrong.success, false);
      assert.equal(resWrong.statusCode, 403);
    });
  });

  // ─── Feature 9: Token-Bucket Rate Limiter ───────────────────────────
  describe('Feature 9: Token-Bucket Rate Limiter', () => {
    it('permits bursts up to capacity and rejects when exhausted', () => {
      const limiter = new RateLimiter({ capacity: 3, refillRate: 1 });

      assert.equal(limiter.tryAcquire('api.github.com'), true);
      assert.equal(limiter.tryAcquire('api.github.com'), true);
      assert.equal(limiter.tryAcquire('api.github.com'), true);
      // Capacity of 3 is now exhausted
      assert.equal(limiter.tryAcquire('api.github.com'), false);

      const status = limiter.getStatus('api.github.com');
      assert.equal(status.remaining, 0);
      assert.equal(status.capacity, 3);
    });

    it('refills tokens over time and supports policy overrides', async () => {
      const limiter = new RateLimiter({ capacity: 5, refillRate: 20 }); // 20 tokens per second
      limiter.tryAcquire('fast-key', 5);
      assert.equal(limiter.getStatus('fast-key').remaining, 0);

      // Wait 100ms for 2 tokens to refill
      await new Promise(r => setTimeout(r, 110));
      assert.equal(limiter.tryAcquire('fast-key', 2), true);
    });
  });

  // ─── Feature 10: Scoped Delegation Tokens ───────────────────────────
  describe('Feature 10: Scoped Delegation Tokens', () => {
    const tokenService = new DelegationTokenService('test_master_delegation_secret');

    it('issues signed tokens and verifies permitted capabilities and levels', () => {
      const token = tokenService.issueToken({
        subject: 'subagent_builder',
        allowedBridges: ['filesystem', 'sqlite'],
        allowedActions: ['read-file', 'query'],
        maxPermissionLevel: 'local-write',
        ttlSeconds: 60,
      });

      const verification = tokenService.verifyToken(token);
      assert.equal(verification.valid, true);
      assert.equal(verification.claims?.subject, 'subagent_builder');

      // Valid execution check
      const check1 = tokenService.canExecute(token, 'filesystem', 'read-file', 'read');
      assert.equal(check1.allowed, true);

      // Forbidden bridge check
      const check2 = tokenService.canExecute(token, 'youtube', 'video-upload', 'publish');
      assert.equal(check2.allowed, false);
      assert.match(check2.reason || '', /Bridge "youtube" is not permitted/);

      // Forbidden permission level check (publish exceeds max local-write)
      const check3 = tokenService.canExecute(token, 'filesystem', 'read-file', 'publish');
      assert.equal(check3.allowed, false);
      assert.match(check3.reason || '', /exceeds token maximum permission level/);
    });

    it('rejects revoked or tampered tokens', () => {
      const token = tokenService.issueToken({
        subject: 'worker',
        allowedBridges: ['*'],
        allowedActions: ['*'],
        maxPermissionLevel: 'read',
      });

      const parsed = tokenService.verifyToken(token);
      const tokenId = parsed.claims!.tokenId;

      tokenService.revokeToken(tokenId, 'Terminated early');
      const revokedCheck = tokenService.verifyToken(token);
      assert.equal(revokedCheck.valid, false);
      assert.match(revokedCheck.error || '', /Token has been revoked/);

      // Tampered token check
      const tampered = token.slice(0, -4) + 'abcd';
      const tamperedCheck = tokenService.verifyToken(tampered);
      assert.equal(tamperedCheck.valid, false);
      assert.match(tamperedCheck.error || '', /cryptographic signature/);
    });
  });

  // ─── Feature 11: Encrypted Vault Backup & Restore ───────────────────
  describe('Feature 11: Encrypted Vault Backup & Restore', () => {
    const vaultService = new VaultBackupService();

    it('exports credentials encrypted with AES-256-GCM and imports with correct passphrase', () => {
      const credentials = {
        GITHUB_TOKEN: 'ghp_secrettoken1234567890',
        SLACK_BOT_TOKEN: 'xoxb-987654321',
        AWS_SECRET_ACCESS_KEY: 'awsSecretKeyXYZ',
      };

      const passphrase = 'CorrectHorseBatteryStaple!2026';
      const backupJson = vaultService.exportVault(credentials, passphrase);

      const inspect = vaultService.inspectBackup(backupJson);
      assert.equal(inspect.valid, true);
      assert.equal(inspect.itemCount, 3);
      assert.ok(inspect.keys?.includes('GITHUB_TOKEN'));

      // Import with correct passphrase
      const importRes = vaultService.importVault(backupJson, passphrase);
      assert.equal(importRes.success, true);
      assert.deepEqual(importRes.credentials, credentials);
    });

    it('fails cleanly without leaking secrets when given an incorrect passphrase', () => {
      const credentials = { SECRET_API_KEY: 'sk_live_12345' };
      const backupJson = vaultService.exportVault(credentials, 'mypassword1');

      const failedRes = vaultService.importVault(backupJson, 'wrongpassword2');
      assert.equal(failedRes.success, false);
      assert.match(failedRes.error || '', /Decryption failed/);
      assert.equal(failedRes.credentials, undefined);
    });
  });

  // ─── Feature 12: Adapter Health Polling & Metrics ───────────────────
  describe('Feature 12: Adapter Health Polling & Metrics', () => {
    it('polls native adapters, measures latency, and tracks transitions', async () => {
      const monitor = new AdapterHealthMonitor();
      const fsAdapter = new FilesystemAdapter();
      monitor.registerAdapter('filesystem', fsAdapter);

      let notified = false;
      monitor.onStatusChange((name, prev, current) => {
        if (name === 'filesystem') {
          notified = true;
        }
      });

      const record = await monitor.checkAdapter('filesystem');
      assert.equal(record.name, 'filesystem');
      assert.equal(record.status, 'healthy');
      assert.ok(record.latencyMs >= 0);
      assert.equal(record.consecutiveFailures, 0);
      assert.equal(notified, true);
    });
  });

  // ─── Feature 13: Interactive Workflow Step Debugger ─────────────────
  describe('Feature 13: Interactive Workflow Step Debugger', () => {
    it('hits breakpoints, pauses execution, allows input mutation, and resumes', async () => {
      const testEngine = new WorkflowEngine(registry, permissions, executor);
      const dbg = new WorkflowStepDebugger(testEngine);

      const workflow: WorkflowDefinition = {
        id: 'debug-sample-wf',
        name: 'Debug Sample Workflow',
        steps: [
          {
            id: 'step1',
            bridge: 'filesystem',
            action: 'read-file',
            inputs: { path: 'package.json' },
          },
          {
            id: 'step2',
            bridge: 'filesystem',
            action: 'read-file',
            inputs: { path: 'package.json' },
          },
        ],
      };

      dbg.setBreakpoint('step2');

      let breakpointHit = false;
      dbg.onEvent((event, state) => {
        if (event === 'breakpoint' && state.currentStepId === 'step2') {
          breakpointHit = true;
          // Mutate inputs at breakpoint
          dbg.mutateStepInputs('step2', { path: 'package.json', mutated: true });
          // Resume execution
          dbg.resume();
        }
      });

      const run = await dbg.startDebugSession(workflow);
      assert.equal(breakpointHit, true);
      assert.equal(run.status, 'completed');
    });
  });

  // ─── Feature 14: Antigravity Skill Generator ────────────────────────
  describe('Feature 14: Antigravity Skill Generator', () => {
    const generator = new AntigravitySkillGenerator();

    it('generates compliant SKILL.md from a BridgeManifest', () => {
      const gitBridge = registry.getBridge('github');
      assert.ok(gitBridge, 'GitHub bridge should exist');

      const skill = generator.generateSkillFromBridge(gitBridge.manifest);
      assert.equal(skill.name, 'af-github');
      assert.ok(skill.content.startsWith('---'));
      assert.ok(skill.content.includes('name: af-github'));
      assert.ok(skill.content.includes('## Capabilities'));
      assert.ok(skill.content.includes('`status-check`'));
      assert.ok(skill.content.includes('`log-inspect`'));
      assert.ok(skill.content.includes('Security & Human-in-the-Loop Guardrails'));
    });

    it('generates compliant SKILL.md from a WorkflowDefinition', () => {
      const workflow: WorkflowDefinition = {
        id: 'ci-pipeline',
        name: 'Continuous Integration Pipeline',
        description: 'Runs tests and prepares release notes',
        steps: [
          { id: 'test', bridge: 'filesystem', action: 'read-file', inputs: {} },
        ],
      };

      const skill = generator.generateSkillFromWorkflow(workflow);
      assert.equal(skill.name, 'workflow-ci-pipeline');
      assert.ok(skill.content.includes('# Workflow: Continuous Integration Pipeline'));
      assert.ok(skill.content.includes('## Workflow Structure'));
      assert.ok(skill.content.includes('Compensation & Recovery'));
    });
  });

  // ─── Feature 15: Run Artifacts & Log Streaming ──────────────────────
  describe('Feature 15: Run Artifacts & Log Streaming', () => {
    it('captures structured output artifacts and streams log events to listeners', () => {
      const service = new RunArtifactsService();
      const runId = 'run_test_artifacts_123';

      // 1. Artifacts
      const art = service.addArtifact({
        runId,
        stepId: 'buildStep',
        name: 'build-report.json',
        mimeType: 'application/json',
        content: '{"passed":10,"failed":0}',
      });

      assert.ok(art.artifactId.startsWith('art_'));
      assert.equal(art.sizeBytes, 24);

      const retrieved = service.getRunArtifacts(runId);
      assert.equal(retrieved.length, 1);
      assert.equal(retrieved[0].name, 'build-report.json');

      // 2. Real-time Log Streaming
      const streamedLogs: string[] = [];
      const unsubscribe = service.subscribeRunLogs(runId, entry => {
        streamedLogs.push(entry.message);
      });

      service.appendLog({ runId, stepId: 'step1', level: 'info', message: 'Starting job' });
      service.appendLog({ runId, stepId: 'step1', level: 'info', message: 'Job completed successfully' });

      assert.equal(streamedLogs.length, 2);
      assert.equal(streamedLogs[0], 'Starting job');
      assert.equal(streamedLogs[1], 'Job completed successfully');

      unsubscribe();

      service.appendLog({ runId, level: 'debug', message: 'After unsubscribe' });
      assert.equal(streamedLogs.length, 2); // should not receive new logs after unsubscribe

      const allLogs = service.getRunLogs(runId);
      assert.equal(allLogs.length, 3);
    });
  });
});
