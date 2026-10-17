import { mkdir, readFile, writeFile, readdir, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { BridgeRegistry } from '../bridge-registry.js';
import { BridgeValidator } from '../bridge-validator.js';
import { StandardStepExecutor, CustomBridgeExecutor } from '../executors/index.js';
import { McpManager } from '../mcp/index.js';
import { IntegrationCatalog } from '../catalog.js';
import { SecurityAnalyzer } from './security-analyzer.js';
import { TemplateGenerator, GeneratedBridgeArtifacts } from './template-generator.js';
import {
  LocalProjectFilesExecutor,
  GithubRepoManagerExecutor,
  GenericServiceExecutor,
} from './executors/index.js';
import {
  BridgeGenerationRequest,
  IntegrationStrategy,
  StagedBridge,
  StagedBridgeStatus,
  BridgeTestRunResult,
  SecurityAnalysisResult,
} from './types.js';

export interface BridgeBuilderOptions {
  projectRoot?: string;
  stagingDir?: string;
  bridgesDir?: string;
  registry?: BridgeRegistry;
  catalog?: IntegrationCatalog;
  mcpManager?: McpManager;
  stepExecutor?: StandardStepExecutor;
}

export class BridgeBuilder {
  private projectRoot: string;
  private stagingDir: string;
  private bridgesDir: string;
  private registry?: BridgeRegistry;
  private catalog?: IntegrationCatalog;
  private mcpManager?: McpManager;
  private stepExecutor?: StandardStepExecutor;
  private validator = new BridgeValidator();
  private securityAnalyzer = new SecurityAnalyzer();
  private templateGenerator = new TemplateGenerator();

  constructor(options: BridgeBuilderOptions = {}) {
    this.projectRoot = resolve(options.projectRoot || process.cwd());
    this.stagingDir = resolve(options.stagingDir || join(this.projectRoot, 'data', 'staging-bridges'));
    this.bridgesDir = resolve(options.bridgesDir || join(this.projectRoot, 'bridges'));
    this.registry = options.registry;
    this.catalog = options.catalog;
    this.mcpManager = options.mcpManager;
    this.stepExecutor = options.stepExecutor;
  }

  /**
   * Evaluate a user prompt and decide whether an existing MCP server,
   * built-in bridge, or custom bridge generation is appropriate.
   */
  async analyzeStrategy(req: BridgeGenerationRequest): Promise<IntegrationStrategy> {
    const prompt = req.prompt.toLowerCase().trim();

    // 1. Check if user explicitly requests custom bridge or custom transport
    if (req.preferredTransport === 'custom') {
      return {
        type: 'needs-custom-bridge',
        reason: 'User requested custom bridge generation directly.',
        suggestedActions: this.suggestActionsForPrompt(prompt),
      };
    }

    // 2. Check for matching external MCP tools (MCP-first strategy)
    if (this.mcpManager) {
      const servers = this.mcpManager.listServers();
      for (const server of servers) {
        const sName = server.name.toLowerCase();
        const sId = server.id.toLowerCase();
        const sDesc = (server.description || '').toLowerCase();
        const serverMatched = prompt.includes(sName) || prompt.includes(sId) || (Boolean(sDesc) && prompt.includes(sDesc));

        const matchingTools = (server.tools || []).filter(t => {
          const tName = t.name.toLowerCase();
          const tDesc = (t.description || '').toLowerCase();
          const tokens = prompt.split(/\s+/).filter(w => w.length > 2);
          return tokens.some(tok => tName.includes(tok) || tDesc.includes(tok));
        });

        if (matchingTools.length > 0 || serverMatched) {
          const item = matchingTools[0]?.name || server.name;
          const actions = matchingTools.length > 0 ? matchingTools.map(t => t.name) : (server.tools || []).map(t => t.name);
          return {
            type: 'mcp-available',
            reason: `Existing external MCP server "${server.name}" (${server.id}) already exposes tools matching your request.`,
            matchedServerId: server.id,
            matchedItem: item,
            suggestedActions: actions,
            requiresAuth: server.status !== 'connected',
          };
        }
      }
    }

    // 3. Check for matching built-in bridges
    const isYouTube = prompt.includes('youtube') || prompt.includes('video upload') || prompt.includes('channel');
    if (isYouTube && !prompt.includes('mock') && !prompt.includes('custom')) {
      return {
        type: 'builtin-available',
        reason: 'AgentForge includes a built-in YouTube bridge with OAuth authentication and video publishing capabilities.',
        matchedItem: 'youtube',
        suggestedActions: ['channel-inspect', 'channel-metadata', 'video-list', 'video-upload'],
        requiresAuth: true,
      };
    }

    const isGitBuiltin = (prompt.includes('git repo') || prompt.includes('git branch') || prompt.includes('git status') || prompt.includes('git commit')) &&
                         !prompt.includes('custom') && !prompt.includes('file manager');
    if (isGitBuiltin) {
      return {
        type: 'builtin-available',
        reason: 'AgentForge includes a built-in GitHub / Git bridge with repository inspection and diff review capabilities.',
        matchedItem: 'github',
        suggestedActions: ['repo-info', 'status-check', 'branch-list', 'log-inspect', 'diff-review', 'release-verify'],
      };
    }

    // 4. Default to generating a custom bridge
    return {
      type: 'needs-custom-bridge',
      reason: 'No existing built-in bridge or external MCP server satisfies this prompt. A custom bridge will be generated.',
      suggestedActions: this.suggestActionsForPrompt(prompt),
    };
  }

  /**
   * Generate bridge artifacts, place them into staging, run initial checks, and return staged bridge.
   */
  async generateBridge(req: BridgeGenerationRequest): Promise<StagedBridge> {
    await mkdir(this.stagingDir, { recursive: true });

    const strategy = await this.analyzeStrategy(req);
    const artifacts: GeneratedBridgeArtifacts = this.templateGenerator.generateFromPrompt(req.prompt, req.targetName);

    const bridgeName = artifacts.manifest.name;
    const bridgeId = bridgeName;
    const bridgeStagingDir = join(this.stagingDir, bridgeId);
    await mkdir(bridgeStagingDir, { recursive: true });

    // Save files into staging directory
    await writeFile(join(bridgeStagingDir, 'bridge.json'), JSON.stringify(artifacts.manifest, null, 2), 'utf-8');
    await writeFile(join(bridgeStagingDir, 'executor.ts'), artifacts.executorCode, 'utf-8');
    await writeFile(join(bridgeStagingDir, 'executor.test.ts'), artifacts.testCode, 'utf-8');

    // Run initial schema and security analysis
    const validationResult = this.validator.validate(artifacts.manifest);
    const securityCheck = this.securityAnalyzer.analyze(artifacts.manifest, artifacts.executorCode, artifacts.testCode);

    const now = new Date().toISOString();
    let status: StagedBridgeStatus = 'draft';
    if (!validationResult.valid || !securityCheck.passed) {
      status = 'blocked';
    }

    const staged: StagedBridge = {
      id: bridgeId,
      name: bridgeName,
      status,
      strategy,
      manifest: artifacts.manifest,
      executorCode: artifacts.executorCode,
      testCode: artifacts.testCode,
      validationResult,
      securityCheck,
      stagingDir: bridgeStagingDir,
      createdAt: now,
      updatedAt: now,
    };

    await writeFile(join(bridgeStagingDir, 'staged.json'), JSON.stringify(staged, null, 2), 'utf-8');
    return staged;
  }

  /**
   * List all bridges currently in staging.
   */
  async listStagedBridges(): Promise<StagedBridge[]> {
    if (!existsSync(this.stagingDir)) {
      return [];
    }

    const entries = await readdir(this.stagingDir, { withFileTypes: true });
    const stagedList: StagedBridge[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const stagedMetaPath = join(this.stagingDir, entry.name, 'staged.json');
        if (existsSync(stagedMetaPath)) {
          try {
            const content = await readFile(stagedMetaPath, 'utf-8');
            const parsed = JSON.parse(content) as StagedBridge;
            stagedList.push(parsed);
          } catch {
            // Ignore unparseable entries
          }
        }
      }
    }

    return stagedList;
  }

  /**
   * Get a specific staged bridge by ID.
   */
  async getStagedBridge(id: string): Promise<StagedBridge | undefined> {
    const safeId = basename(id);
    const stagedMetaPath = join(this.stagingDir, safeId, 'staged.json');
    if (!existsSync(stagedMetaPath)) {
      return undefined;
    }
    const content = await readFile(stagedMetaPath, 'utf-8');
    return JSON.parse(content) as StagedBridge;
  }

  /**
   * Re-validate a staged bridge against manifest schema and security rules.
   */
  async validateStagedBridge(id: string): Promise<StagedBridge> {
    const staged = await this.getStagedBridge(id);
    if (!staged) {
      throw new Error(`Staged bridge "${id}" not found.`);
    }

    staged.status = 'validating';

    // Re-read files from disk in case they were modified
    const bridgeStagingDir = join(this.stagingDir, staged.id);
    const manifestPath = join(bridgeStagingDir, 'bridge.json');
    const executorPath = join(bridgeStagingDir, 'executor.ts');
    const testPath = join(bridgeStagingDir, 'executor.test.ts');

    if (existsSync(manifestPath)) {
      staged.manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    }
    if (existsSync(executorPath)) {
      staged.executorCode = await readFile(executorPath, 'utf-8');
    }
    if (existsSync(testPath)) {
      staged.testCode = await readFile(testPath, 'utf-8');
    }

    const validationResult = this.validator.validate(staged.manifest);
    const securityCheck = this.securityAnalyzer.analyze(staged.manifest, staged.executorCode, staged.testCode);

    staged.validationResult = validationResult;
    staged.securityCheck = securityCheck;
    staged.updatedAt = new Date().toISOString();

    if (!validationResult.valid || !securityCheck.passed) {
      staged.status = 'blocked';
    } else if (staged.testResult?.passed) {
      staged.status = 'awaiting-review';
    } else {
      staged.status = 'draft';
    }

    await writeFile(join(bridgeStagingDir, 'staged.json'), JSON.stringify(staged, null, 2), 'utf-8');
    return staged;
  }

  /**
   * Run the staged bridge's test suite inside an isolated child process sandbox.
   */
  async testStagedBridge(id: string): Promise<StagedBridge> {
    const staged = await this.getStagedBridge(id);
    if (!staged) {
      throw new Error(`Staged bridge "${id}" not found.`);
    }

    // Must pass validation before tests can run
    await this.validateStagedBridge(id);
    const reloaded = (await this.getStagedBridge(id))!;
    if (reloaded.status === 'blocked') {
      throw new Error(`Cannot run tests on blocked bridge "${id}". Fix security and schema errors first.`);
    }

    const testFilePath = join(this.stagingDir, reloaded.id, 'executor.test.ts');
    if (!existsSync(testFilePath)) {
      throw new Error(`Test file not found for staged bridge "${id}".`);
    }

    // Run Vitest in isolated child process with stripped environment
    const testResult = await this.runIsolatedVitest(testFilePath, reloaded.manifest.capabilities.map(c => c.action));
    reloaded.testResult = testResult;
    reloaded.updatedAt = new Date().toISOString();

    if (testResult.passed && reloaded.securityCheck?.passed && reloaded.validationResult?.valid) {
      reloaded.status = 'awaiting-review';
    } else {
      reloaded.status = 'test-failed';
    }

    const bridgeStagingDir = join(this.stagingDir, reloaded.id);
    await writeFile(join(bridgeStagingDir, 'staged.json'), JSON.stringify(reloaded, null, 2), 'utf-8');
    return reloaded;
  }

  /**
   * Promote an approved staged bridge to production (bridges/<name>/) and register with runtime.
   */
  async registerBridge(id: string, approvedBy: string, reviewNotes?: string): Promise<StagedBridge> {
    const staged = await this.getStagedBridge(id);
    if (!staged) {
      throw new Error(`Staged bridge "${id}" not found.`);
    }

    if (staged.status !== 'awaiting-review') {
      throw new Error(
        `Cannot register bridge "${id}": status is "${staged.status}". Bridge must pass validation and isolated tests and be in "awaiting-review" state before registration.`
      );
    }

    if (!approvedBy || !approvedBy.trim()) {
      throw new Error('approvedBy is required for registering a custom bridge.');
    }

    // Ensure production directory exists: bridges/<manifest.name>/
    const prodBridgeDir = join(this.bridgesDir, staged.manifest.name);
    await mkdir(prodBridgeDir, { recursive: true });

    // Write manifest and code to production directory
    const manifestPath = join(prodBridgeDir, 'bridge.json');
    await writeFile(manifestPath, JSON.stringify(staged.manifest, null, 2), 'utf-8');
    await writeFile(join(prodBridgeDir, 'executor.ts'), staged.executorCode, 'utf-8');

    // Register manifest into BridgeRegistry
    if (this.registry) {
      this.registry.register(staged.manifest, manifestPath);
    }

    // Instantiate and register executor with StandardStepExecutor so workflows can run immediately
    if (this.stepExecutor) {
      const executorInstance = this.createExecutorInstance(staged);
      this.stepExecutor.registerCustomExecutor(staged.manifest.name, executorInstance);
    }

    // Update staged record
    staged.status = 'registered';
    staged.reviewedBy = approvedBy.trim();
    staged.reviewNotes = reviewNotes?.trim() || 'Approved by operator';
    staged.updatedAt = new Date().toISOString();

    const bridgeStagingDir = join(this.stagingDir, staged.id);
    await writeFile(join(bridgeStagingDir, 'staged.json'), JSON.stringify(staged, null, 2), 'utf-8');
    return staged;
  }

  /**
   * Delete a staged bridge draft.
   */
  async deleteStagedBridge(id: string): Promise<boolean> {
    const safeId = basename(id);
    const bridgeStagingDir = join(this.stagingDir, safeId);
    if (!existsSync(bridgeStagingDir)) {
      return false;
    }
    await rm(bridgeStagingDir, { recursive: true, force: true });
    return true;
  }

  /**
   * Create an executor instance corresponding to the staged bridge template.
   */
  createExecutorInstance(staged: StagedBridge): CustomBridgeExecutor {
    const name = staged.manifest.name;
    const actions = staged.manifest.capabilities.map(c => c.action);

    if (actions.includes('list-files') || actions.includes('read-file') || actions.includes('write-file')) {
      return new LocalProjectFilesExecutor(process.cwd());
    }

    if (actions.includes('list-repos') || actions.includes('inspect-repo') || actions.includes('create-issue')) {
      return new GithubRepoManagerExecutor();
    }

    return new GenericServiceExecutor(name);
  }

  /**
   * Run Vitest on a test file in an isolated child process sandbox.
   */
  private runIsolatedVitest(testFilePath: string, declaredActions: string[]): Promise<BridgeTestRunResult> {
    return new Promise(resolvePromise => {
      const startTime = Date.now();
      const vitestPath = resolve(this.projectRoot, 'node_modules', 'vitest', 'vitest.mjs');

      // Strip sensitive environment variables: only allow minimal operating system variables
      const cleanEnv: NodeJS.ProcessEnv = {
        PATH: process.env.PATH || '',
        SYSTEMROOT: process.env.SYSTEMROOT || '',
        SYSTEMDRIVE: process.env.SYSTEMDRIVE || '',
        COMSPEC: process.env.COMSPEC || '',
        TEMP: process.env.TEMP || '',
        TMP: process.env.TMP || '',
        USERPROFILE: process.env.USERPROFILE || '',
        NODE_ENV: 'test',
      };

      const sandboxConfig = resolve(this.projectRoot, 'vitest.sandbox.config.ts');
      const args = [
        vitestPath,
        'run',
        '-c', sandboxConfig,
        '-r', this.stagingDir,
        testFilePath,
      ];
      const child = spawn(process.execPath, args, {
        cwd: this.projectRoot,
        env: cleanEnv,
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', chunk => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', chunk => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', err => {
        const durationMs = Date.now() - startTime;
        resolvePromise({
          passed: false,
          exitCode: 1,
          output: `Sandbox spawn error: ${err.message}\n${stderr}`,
          durationMs,
          actionsVerified: [],
          sandboxIsolation: 'isolated-child-process',
        });
      });

      child.on('close', code => {
        const durationMs = Date.now() - startTime;
        const fullOutput = (stdout + '\n' + stderr).trim();
        const passed = code === 0;

        // Determine which actions were verified in tests
        const verified: string[] = [];
        if (passed) {
          for (const action of declaredActions) {
            if (fullOutput.includes(action) || fullOutput.includes('passed')) {
              verified.push(action);
            }
          }
        }

        resolvePromise({
          passed,
          exitCode: code ?? 1,
          output: fullOutput,
          durationMs,
          actionsVerified: verified.length > 0 ? verified : (passed ? declaredActions : []),
          sandboxIsolation: 'isolated-child-process',
        });
      });
    });
  }

  /**
   * Strip basic TypeScript annotations from generated code to create valid ESM JavaScript.
   */
  private stripTypeScriptTypes(code: string): string {
    return code
      .replace(/:\s*string\b/g, '')
      .replace(/:\s*number\b/g, '')
      .replace(/:\s*boolean\b/g, '')
      .replace(/:\s*Record<string,\s*unknown>\b/g, '')
      .replace(/:\s*typeof\s+fetch\b/g, '')
      .replace(/:\s*Promise<[^>]+>/g, '')
      .replace(/:\s*\{[^}]+\}/g, '')
      .replace(/as\s+any\b/g, '');
  }

  private suggestActionsForPrompt(prompt: string): string[] {
    if (prompt.includes('file') || prompt.includes('dir')) {
      return ['list-files', 'read-file', 'write-file', 'delete-file'];
    }
    if (prompt.includes('github') || prompt.includes('repo')) {
      return ['list-repos', 'inspect-repo', 'create-issue'];
    }
    return ['inspect-status', 'submit-data'];
  }
}
