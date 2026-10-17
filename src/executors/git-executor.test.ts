import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { GitExecutor } from './git-executor.js';

describe('GitExecutor (Real Local Git Integration)', () => {
  const executor = new GitExecutor();
  const repoRoot = resolve(import.meta.dirname, '..', '..');

  it('verifies the current workspace is a valid git repository', async () => {
    const isRepo = await executor.isGitRepo(repoRoot);
    expect(isRepo).toBe(true);
  });

  it('rejects a non-git directory with a truthful error', async () => {
    const nonGitDir = resolve(repoRoot, '..');
    // If parent is not a git repo or testing root
    await expect(executor.repoInfo('C:/Windows/System32')).rejects.toThrow('Path is not a git repository');
  });

  it('inspects actual repository metadata (branch, commits, remotes)', async () => {
    const info = await executor.repoInfo(repoRoot);
    expect(info.repoPath).toBe(repoRoot);
    expect(info.branch).toBeDefined();
    expect(typeof info.branch).toBe('string');
    expect(info.latestCommit).not.toBeNull();
    expect(info.latestCommit?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(info.latestCommit?.shortHash).toMatch(/^[0-9a-f]{7,10}$/);
    expect(info.latestCommit?.author).toContain('AgentForge');
  });

  it('checks working tree status truthfully', async () => {
    const status = await executor.statusCheck(repoRoot);
    expect(status.repoPath).toBe(repoRoot);
    expect(typeof status.clean).toBe('boolean');
    expect(Array.isArray(status.staged)).toBe(true);
    expect(Array.isArray(status.modified)).toBe(true);
    expect(Array.isArray(status.untracked)).toBe(true);
  });

  it('lists branches from git', async () => {
    const branches = await executor.branchList(repoRoot);
    expect(Array.isArray(branches.local)).toBe(true);
    expect(branches.local.length).toBeGreaterThanOrEqual(1);
  });

  it('inspects commit log entries', async () => {
    const logs = await executor.logInspect(repoRoot, 5);
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].shortHash).toBeDefined();
    expect(logs[0].subject).toBeDefined();
  });

  it('inspects git diff review', async () => {
    const diff = await executor.diffReview(repoRoot, 'HEAD');
    expect(diff).toHaveProperty('stat');
  });

  it('truthfully reports release status and credentials blocker', async () => {
    const releases = await executor.releaseInfo(repoRoot);
    expect(releases.repoPath).toBe(repoRoot);
    expect(Array.isArray(releases.localTags)).toBe(true);
    expect(releases.remoteAvailable).toBe(false);
    expect(releases.blocker).toBeDefined();
    expect(typeof releases.blocker).toBe('string');
  });

  it('executes via unified dispatcher for all read actions', async () => {
    const info = (await executor.execute('repo-info', { path: repoRoot })) as Record<string, unknown>;
    expect(info).toHaveProperty('branch');

    const status = (await executor.execute('status-check', { path: repoRoot })) as Record<string, unknown>;
    expect(status).toHaveProperty('clean');

    await expect(executor.execute('nonexistent-action')).rejects.toThrow('Unsupported or unimplemented action');
  });

  it('prepares formatted changelog from git history', async () => {
    const result = await executor.changelogPrepare(repoRoot);
    expect(result.repoPath).toBe(repoRoot);
    expect(result.commitCount).toBeGreaterThan(0);
    expect(result.changelog).toContain('## Changelog');
    expect(result.commits.length).toBeGreaterThan(0);

    // Also via execute dispatcher
    const dispatchResult = (await executor.execute('changelog-prepare', { path: repoRoot })) as Record<string, unknown>;
    expect(dispatchResult).toHaveProperty('changelog');
  });

  it('prevents deleting the currently checked out branch', async () => {
    const info = await executor.repoInfo(repoRoot);
    await expect(executor.branchDelete(repoRoot, info.branch)).rejects.toThrow(
      /Cannot delete active checked-out branch/i,
    );
  });

  it('reports blocker when creating release without GITHUB_TOKEN', async () => {
    const savedToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const result = await executor.releaseCreate(repoRoot, {
        tag: 'v1.0.0-test',
        title: 'V1 Test Release',
        body: 'Notes',
      });
      expect(result.success).toBe(false);
      expect(result.blocker).toContain('GITHUB_TOKEN');
    } finally {
      if (savedToken) process.env.GITHUB_TOKEN = savedToken;
    }
  });

  it('supports push-commits and push-tags in dry-run mode', async () => {
    const gitSpy = vi.spyOn(executor, 'runGit').mockImplementation(async args => {
      if (args.includes('--is-inside-work-tree')) {
        return { stdout: 'true', stderr: '' };
      }
      if (args.includes('--abbrev-ref')) {
        return { stdout: 'master', stderr: '' };
      }
      return { stdout: 'Everything up-to-date', stderr: '' };
    });

    const pushResult = (await executor.execute('push-commits', {
      path: repoRoot,
      remote: 'origin',
      dryRun: true,
    })) as Record<string, unknown>;
    expect(pushResult.dryRun).toBe(true);
    expect(pushResult.remote).toBe('origin');

    const tagPushResult = (await executor.execute('push-tags', {
      path: repoRoot,
      remote: 'origin',
      tag: 'v1.0.0',
      dryRun: true,
    })) as Record<string, unknown>;
    expect(tagPushResult.dryRun).toBe(true);
    expect(tagPushResult.tag).toBe('v1.0.0');

    gitSpy.mockRestore();
  });
});
