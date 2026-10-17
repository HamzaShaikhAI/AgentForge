import { StepExecutor } from '../workflow-engine.js';
import { WorkflowStep } from '../types.js';
import { GitExecutor } from './git-executor.js';
import { YouTubeExecutor } from './youtube-executor.js';
import { McpManager } from '../mcp/index.js';
import { redactObject, sanitizeErrorString } from '../auth/redact.js';
import { createBuiltinAdapters } from '../adapters/index.js';

export * from './git-executor.js';
export * from './youtube-executor.js';

export interface CustomBridgeExecutor {
  execute(action: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface StandardStepExecutorOptions {
  gitExecutor?: GitExecutor;
  mcpManager?: McpManager;
  youtubeExecutor?: YouTubeExecutor;
  defaultTimeoutMs?: number;
}

/**
 * Standard router for executing workflow steps across available bridges and external MCP tools.
 * Enforces:
 * - Point-of-execution input parameter validation
 * - Step and action-level timeout handling with timer cleanup
 * - Output secret redaction before results are returned
 * - Error message sanitization
 */
export class StandardStepExecutor implements StepExecutor {
  private gitExecutor: GitExecutor;
  private mcpManager?: McpManager;
  private youtubeExecutor: YouTubeExecutor;
  private customExecutors = new Map<string, CustomBridgeExecutor>();
  private defaultTimeoutMs: number;

  constructor(
    gitExecutorOrOptions?: GitExecutor | StandardStepExecutorOptions,
    mcpManager?: McpManager,
    youtubeExecutor?: YouTubeExecutor,
    defaultTimeoutMs?: number,
  ) {
    if (gitExecutorOrOptions && typeof gitExecutorOrOptions === 'object' && !(gitExecutorOrOptions instanceof GitExecutor)) {
      this.gitExecutor = gitExecutorOrOptions.gitExecutor || new GitExecutor();
      this.mcpManager = gitExecutorOrOptions.mcpManager;
      this.youtubeExecutor = gitExecutorOrOptions.youtubeExecutor || new YouTubeExecutor();
      this.defaultTimeoutMs = gitExecutorOrOptions.defaultTimeoutMs ?? 0;
    } else {
      this.gitExecutor = (gitExecutorOrOptions as GitExecutor) || new GitExecutor();
      this.mcpManager = mcpManager;
      this.youtubeExecutor = youtubeExecutor || new YouTubeExecutor();
      this.defaultTimeoutMs = defaultTimeoutMs ?? 0;
    }

    // Automatically register native integration adapters
    try {
      for (const adapter of createBuiltinAdapters()) {
        if (adapter.name !== 'github' && adapter.name !== 'youtube') {
          this.customExecutors.set(adapter.name, {
            execute: (action, inputs) => adapter.execute(action, inputs),
          });
        }
      }
    } catch {
      // In minimal test setups without adapters loaded
    }
  }

  registerCustomExecutor(bridgeName: string, executor: CustomBridgeExecutor): void {
    this.customExecutors.set(bridgeName, executor);
  }

  unregisterCustomExecutor(bridgeName: string): void {
    this.customExecutors.delete(bridgeName);
  }

  getCustomExecutor(bridgeName: string): CustomBridgeExecutor | undefined {
    return this.customExecutors.get(bridgeName);
  }

  hasCustomExecutor(bridgeName: string): boolean {
    return this.customExecutors.has(bridgeName);
  }

  /**
   * Validate step input parameters before execution.
   */
  private validateInputs(step: WorkflowStep, inputs: Record<string, unknown>): void {
    if (!inputs || typeof inputs !== 'object') {
      throw new Error(`Input validation failed: step "${step.id}" inputs must be an object`);
    }

    if (step.bridge === 'github') {
      if (step.action === 'commit' && (!inputs.message || typeof inputs.message !== 'string' || inputs.message.trim() === '')) {
        throw new Error(`Input validation failed: action "commit" on bridge "github" requires a non-empty string for "message"`);
      }
      if (step.action === 'create-branch' && (!inputs.branch || typeof inputs.branch !== 'string' || inputs.branch.trim() === '')) {
        throw new Error(`Input validation failed: action "create-branch" on bridge "github" requires a non-empty string for "branch"`);
      }
      if (step.action === 'tag-release' && (!inputs.tag || typeof inputs.tag !== 'string' || inputs.tag.trim() === '')) {
        throw new Error(`Input validation failed: action "tag-release" on bridge "github" requires a non-empty string for "tag"`);
      }
    } else if (step.bridge === 'youtube') {
      if (step.action === 'video-upload') {
        if (!inputs.filePath || typeof inputs.filePath !== 'string' || inputs.filePath.trim() === '') {
          throw new Error(`Input validation failed: action "video-upload" on bridge "youtube" requires a non-empty string for "filePath"`);
        }
        if (!inputs.title || typeof inputs.title !== 'string' || inputs.title.trim() === '') {
          throw new Error(`Input validation failed: action "video-upload" on bridge "youtube" requires a non-empty string for "title"`);
        }
      }
      if (step.action === 'set-thumbnail') {
        if (!inputs.videoId || typeof inputs.videoId !== 'string') {
          throw new Error(`Input validation failed: action "set-thumbnail" on bridge "youtube" requires a string for "videoId"`);
        }
        if (!inputs.imagePath || typeof inputs.imagePath !== 'string') {
          throw new Error(`Input validation failed: action "set-thumbnail" on bridge "youtube" requires a string for "imagePath"`);
        }
      }
      if (step.action === 'playlist-add') {
        if (!inputs.playlistId || typeof inputs.playlistId !== 'string') {
          throw new Error(`Input validation failed: action "playlist-add" on bridge "youtube" requires a string for "playlistId"`);
        }
        if (!inputs.videoId || typeof inputs.videoId !== 'string') {
          throw new Error(`Input validation failed: action "playlist-add" on bridge "youtube" requires a string for "videoId"`);
        }
      }
      if (step.action === 'community-post' && (!inputs.text || typeof inputs.text !== 'string')) {
        throw new Error(`Input validation failed: action "community-post" on bridge "youtube" requires a string for "text"`);
      }
    } else if (step.bridge === 'example-echo' || step.bridge === 'example') {
      if (step.action === 'echo' && inputs.message === undefined) {
        throw new Error(`Input validation failed: action "echo" requires "message" input parameter`);
      }
      if (step.action === 'write-file' && (!inputs.path || typeof inputs.path !== 'string')) {
        throw new Error(`Input validation failed: action "write-file" requires a string for "path"`);
      }
    }
  }

  /**
   * Dispatch action to underlying executor target.
   */
  private async dispatchAction(step: WorkflowStep, inputs: Record<string, unknown>): Promise<unknown> {
    if (step.bridge.startsWith('mcp:')) {
      if (!this.mcpManager) {
        throw new Error(`No MCP manager configured to execute external MCP tool for "${step.bridge}"`);
      }
      const serverId = step.bridge.slice(4);
      const res = await this.mcpManager.callTool(serverId, step.action, inputs);
      if (res.status === 'error') {
        throw new Error(res.error || `MCP tool "${step.action}" execution failed`);
      }
      if (res.status === 'blocked') {
        throw new Error(res.error || `MCP tool "${step.action}" was blocked`);
      }
      return res.output;
    }

    if (this.customExecutors.has(step.bridge)) {
      const custom = this.customExecutors.get(step.bridge)!;
      return custom.execute(step.action, inputs);
    }

    if (step.bridge === 'github') {
      return this.gitExecutor.execute(step.action, inputs);
    }

    if (step.bridge === 'youtube') {
      return this.youtubeExecutor.execute(step.action, inputs);
    }

    if (step.bridge === 'example-echo' || step.bridge === 'example') {
      if (step.action === 'echo') {
        return {
          echoed: inputs.message,
          timestamp: new Date().toISOString(),
        };
      }
      if (step.action === 'write-file') {
        return {
          path: inputs.path,
          bytesWritten: typeof inputs.content === 'string' ? inputs.content.length : 0,
          timestamp: new Date().toISOString(),
        };
      }
      if (step.action === 'publish-example') {
        return {
          target: inputs.target,
          published: true,
          timestamp: new Date().toISOString(),
        };
      }
    }

    throw new Error(`No executor implemented for bridge "${step.bridge}"`);
  }

  async execute(step: WorkflowStep, inputs?: Record<string, unknown>): Promise<unknown> {
    const effectiveInputs = inputs ?? step?.inputs ?? {};
    const effectiveStep: WorkflowStep = {
      ...step,
      id: step?.id || step?.action || 'step',
      inputs: effectiveInputs,
    };

    // 1. Point-of-execution parameter validation
    this.validateInputs(effectiveStep, effectiveInputs);

    // 2. Timeout handling
    const timeout = effectiveStep.timeoutMs ?? this.defaultTimeoutMs;
    let rawOutput: unknown;

    try {
      if (timeout && timeout > 0) {
        let timer: NodeJS.Timeout | undefined;
        try {
          const actionPromise = this.dispatchAction(effectiveStep, effectiveInputs);
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`Action "${effectiveStep.action}" on bridge "${effectiveStep.bridge}" timed out after ${timeout}ms`));
            }, timeout);
          });
          rawOutput = await Promise.race([actionPromise, timeoutPromise]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      } else {
        rawOutput = await this.dispatchAction(effectiveStep, effectiveInputs);
      }

      // 3. Output secret redaction
      return redactObject(rawOutput);
    } catch (err) {
      // 4. Error message sanitization
      const message = (err as Error)?.message || String(err);
      throw new Error(sanitizeErrorString(message));
    }
  }
}
