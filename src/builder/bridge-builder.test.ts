import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { BridgeBuilder } from './bridge-builder.js';
import { SecurityAnalyzer } from './security-analyzer.js';
import { TemplateGenerator } from './template-generator.js';
import { BridgeRegistry } from '../bridge-registry.js';
import { StandardStepExecutor } from '../executors/index.js';
import { WorkflowEngine } from '../workflow-engine.js';
import { PermissionManager } from '../permissions.js';
import { McpManager } from '../mcp/mcp-manager.js';
import { BridgeManifest, WorkflowDefinition } from '../types.js';

describe('Custom Bridge Builder (Milestone 7)', () => {
  let tempRoot: string;
  let stagingDir: string;
  let bridgesDir: string;
  let registry: BridgeRegistry;
  let stepExecutor: StandardStepExecutor;
  let builder: BridgeBuilder;
  let permissionManager: PermissionManager;
  let workflowEngine: WorkflowEngine;

  beforeEach(() => {
    tempRoot = join(tmpdir(), 'agentforge-builder-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    stagingDir = join(tempRoot, 'data', 'staging-bridges');
    bridgesDir = join(tempRoot, 'bridges');

    mkdirSync(stagingDir, { recursive: true });
    mkdirSync(bridgesDir, { recursive: true });

    registry = new BridgeRegistry(bridgesDir);
    stepExecutor = new StandardStepExecutor();
    permissionManager = new PermissionManager();
    workflowEngine = new WorkflowEngine(registry, permissionManager, { executor: stepExecutor });

    builder = new BridgeBuilder({
      projectRoot: process.cwd(),
      stagingDir,
      bridgesDir,
      registry,
      stepExecutor,
    });
  });

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('Prompt Analysis & MCP-First Strategy', () => {
    it('detects existing built-in YouTube bridge for video/channel requests', async () => {
      const strategy = await builder.analyzeStrategy({
        prompt: 'Inspect my YouTube channel videos and metrics',
      });
      expect(strategy.type).toBe('builtin-available');
      expect(strategy.matchedItem).toBe('youtube');
      expect(strategy.suggestedActions).toContain('channel-inspect');
      expect(strategy.suggestedActions).toContain('video-upload');
    });

    it('detects existing built-in Git bridge for repository status checks', async () => {
      const strategy = await builder.analyzeStrategy({
        prompt: 'Check git status and current git branch in my repo',
      });
      expect(strategy.type).toBe('builtin-available');
      expect(strategy.matchedItem).toBe('github');
      expect(strategy.suggestedActions).toContain('status-check');
    });

    it('detects matching external MCP server tools (MCP-first strategy)', async () => {
      const mockMcpManager = new McpManager(join(tempRoot, 'mcp-config.json'));
      mockMcpManager.registerClient({
        config: { id: 'sql-db-mcp', name: 'Database MCP Server', transport: 'stdio' },
        getState: () => ({
          id: 'sql-db-mcp',
          name: 'Database MCP Server',
          transport: 'stdio',
          status: 'connected',
          tools: [
            {
              name: 'query-database',
              description: 'Execute SQL select queries against customer database',
              inputSchema: { type: 'object' },
              permissionLevel: 'read',
              requiresApproval: false,
            },
          ],
        }),
      } as any);

      const mcpBuilder = new BridgeBuilder({
        projectRoot: process.cwd(),
        stagingDir,
        bridgesDir,
        registry,
        mcpManager: mockMcpManager,
      });

      const strategy = await mcpBuilder.analyzeStrategy({
        prompt: 'Query customer database table',
      });

      expect(strategy.type).toBe('mcp-available');
      expect(strategy.matchedServerId).toBe('sql-db-mcp');
      expect(strategy.matchedItem).toBe('query-database');
      expect(strategy.suggestedActions).toContain('query-database');
    });

    it('recommends custom bridge generation when no matching integration exists', async () => {
      const strategy = await builder.analyzeStrategy({
        prompt: 'Create a bridge to manage my local project files and directories',
      });
      expect(strategy.type).toBe('needs-custom-bridge');
      expect(strategy.suggestedActions).toContain('list-files');
    });
  });

  describe('Static Security Analyzer (Static Code & Manifest Rigor)', () => {
    const analyzer = new SecurityAnalyzer();

    const validManifest: BridgeManifest = {
      schema: '1.0',
      name: 'safe-bridge',
      displayName: 'Safe Bridge',
      description: 'A completely safe bridge',
      version: '1.0.0',
      category: 'other',
      capabilities: [
        {
          action: 'read-info',
          description: 'Read system info',
          permissionLevel: 'read',
          sideEffects: false,
          inputs: [],
          outputs: [],
        },
      ],
      integrations: [],
      auth: [],
      permissions: [
        {
          actions: 'read-info',
          level: 'read',
          requiresApproval: false,
        },
      ],
    };

    const validExecutor = `
      export class SafeBridgeExecutor {
        async execute(action, inputs) {
          if (action === 'read-info') return { info: 'ok' };
          throw new Error('Unsupported');
        }
      }
    `;

    it('passes for valid manifests with matching executor implementation', () => {
      const res = analyzer.analyze(validManifest, validExecutor, '');
      expect(res.passed).toBe(true);
      expect(res.findings.length).toBe(0);
    });

    it('detects and rejects code injection via eval()', () => {
      const badCode = `
        export class EvilExecutor {
          async execute(action, inputs) {
            eval(inputs.code);
            return {};
          }
        }
      `;
      const res = analyzer.analyze(validManifest, badCode, '');
      expect(res.passed).toBe(false);
      expect(res.noInjections).toBe(false);
      expect(res.findings.some(f => f.check === 'code-injection')).toBe(true);
    });

    it('detects and rejects code injection via dynamic Function constructor', () => {
      const badCode = `
        export class EvilExecutor {
          async execute(action, inputs) {
            const fn = new Function('return ' + inputs.code);
            return fn();
          }
        }
      `;
      const res = analyzer.analyze(validManifest, badCode, '');
      expect(res.passed).toBe(false);
      expect(res.noInjections).toBe(false);
    });

    it('detects and rejects unsafe shell execution with interpolated strings', () => {
      const badCode = `
        import cp from 'node:child_process';
        export class BadExecutor {
          async execute(action, inputs) {
            cp.execSync(\`rm -rf \${inputs.target}\`);
            return {};
          }
        }
      `;
      const res = analyzer.analyze(validManifest, badCode, '');
      expect(res.passed).toBe(false);
      expect(res.findings.some(f => f.check === 'unsafe-shell-exec')).toBe(true);
    });

    it('detects and rejects path traversal patterns', () => {
      const badCode = `
        export class TraversalExecutor {
          async execute(action, inputs) {
            const p = '../../../etc/passwd';
            return { p };
          }
        }
      `;
      const res = analyzer.analyze(validManifest, badCode, '');
      expect(res.passed).toBe(false);
      expect(res.findings.some(f => f.check === 'path-traversal')).toBe(true);
    });

    it('detects and rejects hardcoded API keys and secrets', () => {
      const leakyCode = `
        export class LeakyExecutor {
          private apiKey = "ghp_123456789012345678901234567890";
          async execute(action, inputs) {
            return { token: this.apiKey };
          }
        }
      `;
      const res = analyzer.analyze(validManifest, leakyCode, '');
      expect(res.passed).toBe(false);
      expect(res.noSecretLeaks).toBe(false);
      expect(res.findings.some(f => f.check === 'secret-leakage')).toBe(true);
    });

    it('rejects fake actions where manifest advertises capabilities not implemented in executor', () => {
      const manifestWithMultipleActions: BridgeManifest = {
        ...validManifest,
        capabilities: [
          ...validManifest.capabilities,
          {
            action: 'fake-undeclared-action',
            description: 'Advertised action without real implementation',
            permissionLevel: 'read',
            sideEffects: false,
            inputs: [],
            outputs: [],
          },
        ],
      };

      const res = analyzer.analyze(manifestWithMultipleActions, validExecutor, '');
      expect(res.passed).toBe(false);
      expect(res.noFakeActions).toBe(false);
      expect(res.findings.some(f => f.check === 'action-completeness')).toBe(true);
    });

    it('enforces conservative permission levels and mandatory approval for destructive operations', () => {
      const destructiveManifest: BridgeManifest = {
        ...validManifest,
        capabilities: [
          {
            action: 'delete-database-record',
            description: 'Permanently remove database records',
            permissionLevel: 'read', // WRONG: claims to be read!
            sideEffects: true,
            inputs: [],
            outputs: [],
          },
        ],
        permissions: [
          {
            actions: 'delete-database-record',
            level: 'read',
            requiresApproval: false,
          },
        ],
      };

      const executor = `
        export class DBExecutor {
          async execute(action) {
            if (action === 'delete-database-record') return {};
          }
        }
      `;

      const res = analyzer.analyze(destructiveManifest, executor, '');
      expect(res.passed).toBe(false);
      expect(res.safePermissions).toBe(false);
      expect(res.findings.some(f => f.check === 'permission-rigor')).toBe(true);
    });

    it('enforces conservative permission levels and mandatory approval for publishing operations', () => {
      const publishManifest: BridgeManifest = {
        ...validManifest,
        capabilities: [
          {
            action: 'publish-package',
            description: 'Publish release package to registry',
            permissionLevel: 'local-write', // WRONG: claims to be local-write!
            sideEffects: true,
            inputs: [],
            outputs: [],
          },
        ],
        permissions: [
          {
            actions: 'publish-package',
            level: 'local-write',
            requiresApproval: false,
          },
        ],
      };

      const executor = `
        export class PubExecutor {
          async execute(action) {
            if (action === 'publish-package') return {};
          }
        }
      `;

      const res = analyzer.analyze(publishManifest, executor, '');
      expect(res.passed).toBe(false);
      expect(res.safePermissions).toBe(false);
      expect(res.findings.some(f => f.message.includes('Must be "publish"'))).toBe(true);
    });
  });

  describe('Staged Bridge Lifecycle & Isolation', () => {
    it('generates a draft bridge in staging with valid manifest and test suite', async () => {
      const staged = await builder.generateBridge({
        prompt: 'Manage local project files and directories safely',
        targetName: 'local-file-helper',
      });

      expect(staged.id).toBe('local-file-helper');
      expect(staged.name).toBe('local-file-helper');
      expect(staged.status).toBe('draft');
      expect(existsSync(join(stagingDir, 'local-file-helper', 'bridge.json'))).toBe(true);
      expect(existsSync(join(stagingDir, 'local-file-helper', 'executor.ts'))).toBe(true);
      expect(existsSync(join(stagingDir, 'local-file-helper', 'executor.test.ts'))).toBe(true);
      expect(existsSync(join(stagingDir, 'local-file-helper', 'staged.json'))).toBe(true);
    });

    it('lists all staged bridges accurately', async () => {
      await builder.generateBridge({ prompt: 'file manager', targetName: 'bridge-a' });
      await builder.generateBridge({ prompt: 'github repo manager', targetName: 'bridge-b' });

      const list = await builder.listStagedBridges();
      expect(list.length).toBe(2);
      expect(list.map(s => s.name)).toContain('bridge-a');
      expect(list.map(s => s.name)).toContain('bridge-b');
    });

    it('runs isolated vitest tests in sandbox and transitions to awaiting-review on pass', async () => {
      const staged = await builder.generateBridge({
        prompt: 'Create custom service bridge',
        targetName: 'custom-status-service',
      });

      expect(staged.status).toBe('draft');

      const tested = await builder.testStagedBridge(staged.id);
      expect(tested.status).toBe('awaiting-review');
      expect(tested.testResult).toBeDefined();
      expect(tested.testResult?.passed).toBe(true);
      expect(tested.testResult?.sandboxIsolation).toBe('isolated-child-process');
      expect(tested.testResult?.actionsVerified).toContain('inspect-status');
      expect(tested.testResult?.actionsVerified).toContain('submit-data');
    }, 15000);

    it('prevents registering a bridge that has not passed tests and review', async () => {
      const staged = await builder.generateBridge({
        prompt: 'Create custom service bridge',
        targetName: 'untested-service',
      });

      // Still in draft status!
      await expect(builder.registerBridge(staged.id, 'operator-alice')).rejects.toThrow(
        /must pass validation and isolated tests and be in "awaiting-review" state/i
      );
    });

    it('prevents registration without an explicit operator approval identity', async () => {
      const staged = await builder.generateBridge({
        prompt: 'Create custom service bridge',
        targetName: 'no-operator-service',
      });
      await builder.testStagedBridge(staged.id);

      await expect(builder.registerBridge(staged.id, '')).rejects.toThrow(/approvedBy is required/i);
    }, 15000);

    it('promotes approved bridge to production and registers with BridgeRegistry & StepExecutor', async () => {
      const staged = await builder.generateBridge({
        prompt: 'Manage local project files and read directory',
        targetName: 'project-file-bridge',
      });

      await builder.testStagedBridge(staged.id);

      const registered = await builder.registerBridge(
        staged.id,
        'security-officer-bob',
        'Verified path traversal tests and conservative permissions'
      );

      expect(registered.status).toBe('registered');
      expect(registered.reviewedBy).toBe('security-officer-bob');

      // Verify files in production bridges/
      const prodPath = join(bridgesDir, 'project-file-bridge', 'bridge.json');
      expect(existsSync(prodPath)).toBe(true);

      // Verify loaded in BridgeRegistry
      const entry = registry.get('project-file-bridge');
      expect(entry).toBeDefined();
      expect(entry?.manifest.name).toBe('project-file-bridge');

      // Verify custom executor is registered with StandardStepExecutor
      expect(stepExecutor.hasCustomExecutor('project-file-bridge')).toBe(true);
    }, 15000);

    it('executes workflow using newly registered custom bridge with permission enforcement', async () => {
      // 1. Generate, test, and register the local-files bridge
      const staged = await builder.generateBridge({
        prompt: 'Local project file manager',
        targetName: 'workspace-fs',
      });
      await builder.testStagedBridge(staged.id);
      await builder.registerBridge(staged.id, 'admin-carol');

      // 2. Define workflow that calls workspace-fs list-files and write-file
      const workflow: WorkflowDefinition = {
        id: 'test-custom-bridge-workflow',
        name: 'Custom Bridge File Workflow',
        description: 'Verify custom bridge step execution',
        steps: [
          {
            id: 'step-1',
            name: 'List workspace files',
            bridge: 'workspace-fs',
            action: 'list-files',
            inputs: { directory: '.' },
          },
          {
            id: 'step-2',
            name: 'Write audit file',
            bridge: 'workspace-fs',
            action: 'write-file',
            inputs: {
              filePath: 'custom-bridge-output.txt',
              content: 'Execution verified successfully',
            },
          },
        ],
      };

      // 3. Execute workflow run
      const run = workflowEngine.createRun(workflow);
      const executedRun = await workflowEngine.executeRun(workflow, run);

      expect(executedRun.status).toBe('completed');
      expect(executedRun.steps.length).toBe(2);
      expect(executedRun.steps[0].status).toBe('completed');
      expect((executedRun.steps[0].output as any)?.files).toBeDefined();
      expect(executedRun.steps[1].status).toBe('completed');
      expect((executedRun.steps[1].output as any)?.success).toBe(true);

      // 4. Test destructive action pauses at approval checkpoint
      const destructiveWorkflow: WorkflowDefinition = {
        id: 'destructive-custom-workflow',
        name: 'Destructive File Workflow',
        description: 'Ensure destructive action requires approval',
        steps: [
          {
            id: 'del-step',
            name: 'Delete output file',
            bridge: 'workspace-fs',
            action: 'delete-file',
            inputs: { filePath: 'custom-bridge-output.txt' },
          },
        ],
      };

      const destRun = workflowEngine.createRun(destructiveWorkflow);
      const pausedRun = await workflowEngine.executeRun(destructiveWorkflow, destRun);

      expect(pausedRun.status).toBe('paused_for_approval');
      expect(pausedRun.pendingApproval).toBeDefined();
      expect(pausedRun.pendingApproval?.permissionLevel).toBe('destructive');

      // Resume with operator approval
      const approvedRun = await workflowEngine.approveStep(
        destRun.runId,
        pausedRun.pendingApproval!.approvalRequestId,
        {
          approvedBy: 'operator-dave',
          confirmed: true,
          reason: 'Authorized file cleanup',
        },
      );

      const resumedRun = await workflowEngine.resumeRun(destructiveWorkflow, approvedRun);
      expect(resumedRun.status).toBe('completed');
      expect((resumedRun.steps[0].output as any)?.deleted).toBe(true);
    }, 15000);

    it('safely deletes a staged bridge draft', async () => {
      const staged = await builder.generateBridge({
        prompt: 'temporary test bridge',
        targetName: 'temp-to-delete',
      });
      expect(existsSync(join(stagingDir, 'temp-to-delete'))).toBe(true);

      const deleted = await builder.deleteStagedBridge('temp-to-delete');
      expect(deleted).toBe(true);
      expect(existsSync(join(stagingDir, 'temp-to-delete'))).toBe(false);
    });
  });
});
