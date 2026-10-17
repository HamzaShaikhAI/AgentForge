import { StepExecutor } from '../workflow-engine.js';
import { WorkflowStep } from '../types.js';
import { GitExecutor } from './git-executor.js';
import { YouTubeExecutor } from './youtube-executor.js';
import { McpManager } from '../mcp/index.js';

export * from './git-executor.js';
export * from './youtube-executor.js';

export interface CustomBridgeExecutor {
  execute(action: string, inputs: Record<string, unknown>): Promise<unknown>;
}

/**
 * Standard router for executing workflow steps across available bridges and external MCP tools.
 */
export class StandardStepExecutor implements StepExecutor {
  private gitExecutor: GitExecutor;
  private mcpManager?: McpManager;
  private youtubeExecutor: YouTubeExecutor;
  private customExecutors = new Map<string, CustomBridgeExecutor>();

  constructor(
    gitExecutorOrOptions?: GitExecutor | { gitExecutor?: GitExecutor; mcpManager?: McpManager; youtubeExecutor?: YouTubeExecutor },
    mcpManager?: McpManager,
    youtubeExecutor?: YouTubeExecutor,
  ) {
    if (gitExecutorOrOptions && typeof gitExecutorOrOptions === 'object' && !(gitExecutorOrOptions instanceof GitExecutor)) {
      this.gitExecutor = gitExecutorOrOptions.gitExecutor || new GitExecutor();
      this.mcpManager = gitExecutorOrOptions.mcpManager;
      this.youtubeExecutor = gitExecutorOrOptions.youtubeExecutor || new YouTubeExecutor();
    } else {
      this.gitExecutor = (gitExecutorOrOptions as GitExecutor) || new GitExecutor();
      this.mcpManager = mcpManager;
      this.youtubeExecutor = youtubeExecutor || new YouTubeExecutor();
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

  async execute(step: WorkflowStep, inputs: Record<string, unknown>): Promise<unknown> {
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
}

