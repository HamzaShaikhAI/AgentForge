import { describe, it, expect } from 'vitest';
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
});
