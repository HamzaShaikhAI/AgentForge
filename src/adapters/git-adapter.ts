import { BaseIntegrationAdapter, AdapterHealthResult, AdapterActionDefinition } from './base-adapter.js';
import { GitExecutor } from '../executors/git-executor.js';

export class GitAdapter extends BaseIntegrationAdapter {
  readonly name = 'github';
  readonly displayName = 'GitHub & Local Git';
  readonly description = 'Local Git repository inspection, commit history, diff review, and GitHub repository actions.';
  readonly version = '1.0.0';
  readonly category = 'source-control';

  private gitExecutor: GitExecutor;

  constructor(gitExecutor = new GitExecutor()) {
    super();
    this.gitExecutor = gitExecutor;
  }

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'repo-info', description: 'Get repository information, branch, and latest commit', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'status-check', description: 'Check working tree status and staged changes', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'branch-list', description: 'List local and remote branches', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'log-inspect', description: 'Inspect recent commit history', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'diff-review', description: 'Review changes against a reference', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'commit', description: 'Commit staged changes to repository', permissionLevel: 'local-write', sideEffects: true, requiresApproval: false },
      { action: 'create-branch', description: 'Create a new git branch', permissionLevel: 'local-write', sideEffects: true, requiresApproval: false },
      { action: 'push-commits', description: 'Push local commits to remote repository', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
      { action: 'tag-release', description: 'Create and push a release tag', permissionLevel: 'publish', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    try {
      const gitInstalled = await this.gitExecutor.isGitInstalled();
      if (!gitInstalled) {
        return {
          healthy: false,
          status: 'unconfigured',
          message: 'Git CLI executable not found on host PATH',
        };
      }
      return {
        healthy: true,
        status: 'available',
        message: 'Git CLI is installed and available',
      };
    } catch (err) {
      return {
        healthy: false,
        status: 'error',
        message: (err as Error).message,
      };
    }
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    return this.gitExecutor.execute(action, inputs);
  }
}
