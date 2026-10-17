import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);

export interface GitRepoInfo {
  repoPath: string;
  branch: string;
  remotes: string[];
  latestCommit: {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    date: string;
  } | null;
}

export interface GitStatusResult {
  repoPath: string;
  branch: string;
  tracking?: string;
  clean: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export interface GitReleaseInfo {
  repoPath: string;
  localTags: string[];
  remoteReleases: Array<{
    tag: string;
    title: string;
    publishedAt: string;
    htmlUrl: string;
    isDraft: boolean;
    isPrerelease: boolean;
  }> | null;
  remoteAvailable: boolean;
  blocker?: string;
}

export class GitExecutor {
  /**
   * Run a git command in a specific directory using execFile (prevents shell injection).
   */
  async runGit(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
    const resolvedCwd = resolve(cwd || process.cwd());
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd: resolvedCwd,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err: unknown) {
      const error = err as Error & { stderr?: string; stdout?: string; code?: number };
      const msg = error.stderr?.trim() || error.message;
      throw new Error(`Git error: ${msg}`);
    }
  }

  /**
   * Check if git executable is available on PATH.
   */
  async isGitInstalled(): Promise<boolean> {
    try {
      await this.runGit(['--version']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a path is a valid git repository.
   */
  async isGitRepo(repoPath?: string): Promise<boolean> {
    try {
      const { stdout } = await this.runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
      return stdout === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Inspect basic repository metadata.
   */
  async repoInfo(repoPath?: string): Promise<GitRepoInfo> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const isRepo = await this.isGitRepo(resolvedPath);
    if (!isRepo) {
      throw new Error(`Path is not a git repository: ${resolvedPath}`);
    }

    // Branch name
    let branch = 'HEAD';
    try {
      const { stdout } = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], resolvedPath);
      branch = stdout;
    } catch {
      // Empty repo or detached HEAD
    }

    // Remotes
    const remotes: string[] = [];
    try {
      const { stdout } = await this.runGit(['remote', '-v'], resolvedPath);
      if (stdout) {
        const lines = stdout.split('\n');
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length >= 2 && !remotes.includes(parts[1])) {
            remotes.push(parts[1]);
          }
        }
      }
    } catch {
      // No remotes configured
    }

    // Latest commit
    let latestCommit: GitRepoInfo['latestCommit'] = null;
    try {
      const { stdout } = await this.runGit(
        ['log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an <%ae>%x1f%aI'],
        resolvedPath,
      );
      if (stdout) {
        const [hash, shortHash, subject, author, date] = stdout.split('\x1f');
        latestCommit = { hash, shortHash, subject, author, date };
      }
    } catch {
      // No commits yet
    }

    return {
      repoPath: resolvedPath,
      branch,
      remotes,
      latestCommit,
    };
  }

  /**
   * Check working tree status (porcelain).
   */
  async statusCheck(repoPath?: string): Promise<GitStatusResult> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const { stdout } = await this.runGit(['status', '--porcelain=v1', '-b'], resolvedPath);

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];
    let branch = 'unknown';
    let tracking: string | undefined;

    const lines = stdout ? stdout.split('\n') : [];
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) continue;

      if (line.startsWith('## ')) {
        const branchHeader = line.slice(3);
        if (branchHeader.includes('...')) {
          const [b, track] = branchHeader.split('...');
          branch = b.trim();
          tracking = track.trim();
        } else {
          branch = branchHeader.trim();
        }
        continue;
      }

      const x = line[0];
      const y = line[1];
      const file = line.slice(3).trim();

      if (line.startsWith('??')) {
        untracked.push(file);
      } else {
        if (x !== ' ' && x !== '?') {
          staged.push(`${x} ${file}`);
        }
        if (y !== ' ' && y !== '?') {
          modified.push(`${y} ${file}`);
        }
      }
    }

    return {
      repoPath: resolvedPath,
      branch,
      tracking,
      clean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
      staged,
      modified,
      untracked,
    };
  }

  /**
   * List local and remote branches.
   */
  async branchList(repoPath?: string): Promise<{ current: string; local: string[]; remote: string[] }> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const { stdout } = await this.runGit(
      ['branch', '-a', '--format=%(refname:short)%x1f%(HEAD)'],
      resolvedPath,
    );

    let current = '';
    const local: string[] = [];
    const remote: string[] = [];

    if (stdout) {
      for (const line of stdout.split('\n')) {
        const [ref, head] = line.split('\x1f');
        if (!ref) continue;
        if (head && head.trim() === '*') {
          current = ref.trim();
        }
        if (ref.startsWith('origin/') || ref.includes('/')) {
          remote.push(ref.trim());
        } else {
          local.push(ref.trim());
        }
      }
    }

    return { current, local, remote };
  }

  /**
   * Inspect commit history.
   */
  async logInspect(
    repoPath?: string,
    count = 10,
    since?: string,
  ): Promise<Array<{ hash: string; shortHash: string; subject: string; author: string; date: string }>> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const args = ['log', `-n${count}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI'];
    if (since) {
      args.push(`--since=${since}`);
    }

    const { stdout } = await this.runGit(args, resolvedPath);
    if (!stdout) return [];

    return stdout.split('\n').filter(Boolean).map(line => {
      const [hash, shortHash, subject, author, date] = line.split('\x1f');
      return { hash, shortHash, subject, author, date };
    });
  }

  /**
   * Review git diff between references.
   */
  async diffReview(repoPath?: string, base = 'HEAD', head?: string): Promise<{ stat: string }> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const target = head ? `${base}..${head}` : base;
    const { stdout } = await this.runGit(['diff', '--stat', target], resolvedPath);
    return { stat: stdout };
  }

  /**
   * Inspect release information (local tags + remote GitHub releases if configured).
   */
  async releaseInfo(repoPath?: string): Promise<GitReleaseInfo> {
    const resolvedPath = resolve(repoPath || process.cwd());

    // 1. Local tags
    const localTags: string[] = [];
    try {
      const { stdout } = await this.runGit(['tag', '-l', '--sort=-creatordate'], resolvedPath);
      if (stdout) {
        localTags.push(...stdout.split('\n').map(t => t.trim()).filter(Boolean));
      }
    } catch {
      // No tags
    }

    // 2. Detect GitHub remote repository
    const githubOwnerRepo = await this.getGitHubOwnerRepo(resolvedPath);

    // 3. Remote releases
    const token = process.env.GITHUB_TOKEN;
    if (githubOwnerRepo && token) {
      try {
        const url = `https://api.github.com/repos/${githubOwnerRepo.owner}/${githubOwnerRepo.repo}/releases?per_page=10`;
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'AgentForge-Harness',
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `Bearer ${token}`,
          },
        });
        if (resp.ok) {
          const data = (await resp.json()) as Array<{
            tag_name: string;
            name: string;
            published_at: string;
            html_url: string;
            draft: boolean;
            prerelease: boolean;
          }>;
          const remoteReleases = data.map(r => ({
            tag: r.tag_name,
            title: r.name || r.tag_name,
            publishedAt: r.published_at,
            htmlUrl: r.html_url,
            isDraft: r.draft,
            isPrerelease: r.prerelease,
          }));
          return {
            repoPath: resolvedPath,
            localTags,
            remoteReleases,
            remoteAvailable: true,
          };
        } else {
          return {
            repoPath: resolvedPath,
            localTags,
            remoteReleases: null,
            remoteAvailable: false,
            blocker: `GitHub API error: HTTP ${resp.status} ${resp.statusText}`,
          };
        }
      } catch (err) {
        return {
          repoPath: resolvedPath,
          localTags,
          remoteReleases: null,
          remoteAvailable: false,
          blocker: `GitHub API request failed: ${(err as Error).message}`,
        };
      }
    }

    // If no remote repo or no token, report blocker honestly
    let blocker = 'No GitHub remote repository detected for this workspace.';
    if (githubOwnerRepo) {
      blocker = `Remote release inspection requires GITHUB_TOKEN environment variable (detected repo: ${githubOwnerRepo.owner}/${githubOwnerRepo.repo}). Local tags are available.`;
    }

    return {
      repoPath: resolvedPath,
      localTags,
      remoteReleases: null,
      remoteAvailable: false,
      blocker,
    };
  }

  /**
   * Resolve owner and repository name from git remotes.
   */
  async getGitHubOwnerRepo(repoPath?: string): Promise<{ owner: string; repo: string } | null> {
    const resolvedPath = resolve(repoPath || process.cwd());
    try {
      const { stdout } = await this.runGit(['remote', '-v'], resolvedPath);
      const match = stdout.match(/github\.com[:/]([^/]+)\/([^/\s.]+)(?:\.git)?/i);
      if (match) {
        return { owner: match[1], repo: match[2] };
      }
    } catch {
      // Ignore
    }
    return null;
  }

  /**
   * Generate changelog from commit history between two references.
   */
  async changelogPrepare(
    repoPath?: string,
    from?: string,
    to = 'HEAD',
  ): Promise<{
    repoPath: string;
    from: string | null;
    to: string;
    commitCount: number;
    changelog: string;
    commits: Array<{ hash: string; subject: string; author: string; date: string }>;
  }> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const isRepo = await this.isGitRepo(resolvedPath);
    if (!isRepo) {
      throw new Error(`Path is not a git repository: ${resolvedPath}`);
    }

    let revisionRange = to;
    let resolvedFrom: string | null = from || null;

    if (!from) {
      try {
        const { stdout } = await this.runGit(['describe', '--tags', '--abbrev=0'], resolvedPath);
        if (stdout) {
          resolvedFrom = stdout;
          revisionRange = `${stdout}..${to}`;
        }
      } catch {
        revisionRange = to;
      }
    } else {
      revisionRange = `${from}..${to}`;
    }

    let { stdout } = await this.runGit(
      ['log', revisionRange, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI'],
      resolvedPath,
    );

    if ((!stdout || stdout.trim() === '') && !from) {
      const fallback = await this.runGit(
        ['log', '-n', '20', to, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI'],
        resolvedPath,
      );
      stdout = fallback.stdout;
    }

    const commits: Array<{ hash: string; subject: string; author: string; date: string }> = [];
    if (stdout) {
      const lines = stdout.split('\n');
      for (const line of lines) {
        const [fullHash, shortHash, subject, author, date] = line.split('\x1f');
        if (fullHash && subject) {
          commits.push({ hash: shortHash || fullHash, subject, author: author || '', date: date || '' });
        }
      }
    }

    const features: string[] = [];
    const fixes: string[] = [];
    const docs: string[] = [];
    const chores: string[] = [];
    const others: string[] = [];

    for (const c of commits) {
      const entry = `- ${c.subject} (${c.hash}) by ${c.author}`;
      const lower = c.subject.toLowerCase();
      if (/^feat(\(.*\))?:/.test(lower)) {
        features.push(entry);
      } else if (/^fix(\(.*\))?:/.test(lower)) {
        fixes.push(entry);
      } else if (/^docs(\(.*\))?:/.test(lower)) {
        docs.push(entry);
      } else if (/^(chore|refactor|test|ci|perf)(\(.*\))?:/.test(lower)) {
        chores.push(entry);
      } else {
        others.push(entry);
      }
    }

    const sections: string[] = [];
    sections.push(`## Changelog (${resolvedFrom ? `${resolvedFrom}..${to}` : to})`);
    sections.push(`*Generated at ${new Date().toISOString()}*\n`);

    if (features.length > 0) sections.push('### Features\n' + features.join('\n'));
    if (fixes.length > 0) sections.push('### Bug Fixes\n' + fixes.join('\n'));
    if (docs.length > 0) sections.push('### Documentation\n' + docs.join('\n'));
    if (chores.length > 0) sections.push('### Maintenance & Chores\n' + chores.join('\n'));
    if (others.length > 0) sections.push('### Other Changes\n' + others.join('\n'));
    if (commits.length === 0) sections.push('_No commits found in specified range._');

    return {
      repoPath: resolvedPath,
      from: resolvedFrom,
      to,
      commitCount: commits.length,
      changelog: sections.join('\n\n'),
      commits,
    };
  }

  /**
   * Create a local git tag (does not push).
   */
  async tagCreate(
    repoPath: string | undefined,
    name: string,
    message?: string,
  ): Promise<{ success: boolean; repoPath: string; tag: string; message?: string }> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const isRepo = await this.isGitRepo(resolvedPath);
    if (!isRepo) throw new Error(`Path is not a git repository: ${resolvedPath}`);

    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Tag name is required');

    const { stdout: existing } = await this.runGit(['tag', '-l', trimmedName], resolvedPath);
    if (existing && existing.split('\n').map(t => t.trim()).includes(trimmedName)) {
      throw new Error(`Git tag already exists: "${trimmedName}"`);
    }

    if (message && message.trim()) {
      await this.runGit(['tag', '-a', trimmedName, '-m', message.trim()], resolvedPath);
    } else {
      await this.runGit(['tag', trimmedName], resolvedPath);
    }

    return {
      success: true,
      repoPath: resolvedPath,
      tag: trimmedName,
      message: message?.trim() || undefined,
    };
  }

  /**
   * Push local commits to remote.
   */
  async pushCommits(
    repoPath: string | undefined,
    remote = 'origin',
    branch?: string,
    dryRun = false,
  ): Promise<{ success: boolean; repoPath: string; remote: string; branch: string; dryRun: boolean; output: string }> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const isRepo = await this.isGitRepo(resolvedPath);
    if (!isRepo) throw new Error(`Path is not a git repository: ${resolvedPath}`);

    let targetBranch = branch?.trim();
    if (!targetBranch) {
      const { stdout } = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], resolvedPath);
      targetBranch = stdout || 'HEAD';
    }

    const args = ['push'];
    if (dryRun) args.push('--dry-run');
    args.push(remote, targetBranch);

    const { stdout, stderr } = await this.runGit(args, resolvedPath);
    return {
      success: true,
      repoPath: resolvedPath,
      remote,
      branch: targetBranch,
      dryRun,
      output: stdout || stderr || 'Push completed successfully',
    };
  }

  /**
   * Push tags to remote.
   */
  async pushTags(
    repoPath: string | undefined,
    remote = 'origin',
    tag?: string,
    dryRun = false,
  ): Promise<{ success: boolean; repoPath: string; remote: string; tag: string; dryRun: boolean; output: string }> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const isRepo = await this.isGitRepo(resolvedPath);
    if (!isRepo) throw new Error(`Path is not a git repository: ${resolvedPath}`);

    const args = ['push'];
    if (dryRun) args.push('--dry-run');
    args.push(remote);
    if (tag && tag.trim()) {
      args.push(tag.trim());
    } else {
      args.push('--tags');
    }

    const { stdout, stderr } = await this.runGit(args, resolvedPath);
    return {
      success: true,
      repoPath: resolvedPath,
      remote,
      tag: tag?.trim() || '--tags',
      dryRun,
      output: stdout || stderr || 'Tags pushed successfully',
    };
  }

  /**
   * Create a GitHub release via REST API (requires GITHUB_TOKEN).
   */
  async releaseCreate(
    repoPath: string | undefined,
    options: {
      tag: string;
      title: string;
      body: string;
      draft?: boolean;
      prerelease?: boolean;
    },
  ): Promise<{
    success: boolean;
    repoPath: string;
    releaseId?: number;
    tag: string;
    title: string;
    htmlUrl?: string;
    isDraft?: boolean;
    isPrerelease?: boolean;
    createdAt?: string;
    blocker?: string;
  }> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const isRepo = await this.isGitRepo(resolvedPath);
    if (!isRepo) throw new Error(`Path is not a git repository: ${resolvedPath}`);

    const token = process.env.GITHUB_TOKEN;
    const githubOwnerRepo = await this.getGitHubOwnerRepo(resolvedPath);

    if (!githubOwnerRepo) {
      return {
        success: false,
        repoPath: resolvedPath,
        tag: options.tag,
        title: options.title,
        blocker: 'No GitHub remote repository detected for this workspace.',
      };
    }

    if (!token) {
      return {
        success: false,
        repoPath: resolvedPath,
        tag: options.tag,
        title: options.title,
        blocker: `GitHub release creation requires GITHUB_TOKEN environment variable (detected repo: ${githubOwnerRepo.owner}/${githubOwnerRepo.repo}).`,
      };
    }

    const url = `https://api.github.com/repos/${githubOwnerRepo.owner}/${githubOwnerRepo.repo}/releases`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'AgentForge-Harness',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tag_name: options.tag,
        name: options.title,
        body: options.body,
        draft: Boolean(options.draft),
        prerelease: Boolean(options.prerelease),
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let errorMsg = `HTTP ${resp.status} ${resp.statusText}`;
      try {
        const errJson = JSON.parse(errText);
        errorMsg = errJson.message || errorMsg;
      } catch {
        errorMsg = errText || errorMsg;
      }
      throw new Error(`GitHub release creation failed: ${errorMsg}`);
    }

    const data = (await resp.json()) as {
      id: number;
      tag_name: string;
      name: string;
      html_url: string;
      draft: boolean;
      prerelease: boolean;
      created_at: string;
    };

    return {
      success: true,
      repoPath: resolvedPath,
      releaseId: data.id,
      tag: data.tag_name,
      title: data.name,
      htmlUrl: data.html_url,
      isDraft: data.draft,
      isPrerelease: data.prerelease,
      createdAt: data.created_at,
    };
  }

  /**
   * Delete a branch (local or remote).
   */
  async branchDelete(
    repoPath: string | undefined,
    branch: string,
    remote = false,
    force = false,
  ): Promise<{ success: boolean; repoPath: string; branch: string; remote: boolean; force: boolean; output: string }> {
    const resolvedPath = resolve(repoPath || process.cwd());
    const isRepo = await this.isGitRepo(resolvedPath);
    if (!isRepo) throw new Error(`Path is not a git repository: ${resolvedPath}`);

    const targetBranch = branch.trim();
    if (!targetBranch) throw new Error('Branch name is required');

    const { stdout: current } = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], resolvedPath);
    if (current && current.trim() === targetBranch) {
      throw new Error(`Cannot delete active checked-out branch "${targetBranch}". Switch to another branch first.`);
    }

    if (remote) {
      const { stdout, stderr } = await this.runGit(['push', 'origin', '--delete', targetBranch], resolvedPath);
      return {
        success: true,
        repoPath: resolvedPath,
        branch: targetBranch,
        remote: true,
        force,
        output: stdout || stderr || `Remote branch ${targetBranch} deleted successfully`,
      };
    } else {
      const { stdout, stderr } = await this.runGit(['branch', force ? '-D' : '-d', targetBranch], resolvedPath);
      return {
        success: true,
        repoPath: resolvedPath,
        branch: targetBranch,
        remote: false,
        force,
        output: stdout || stderr || `Local branch ${targetBranch} deleted successfully`,
      };
    }
  }

  /**
   * Action dispatcher for the GitHub bridge.
   */
  async execute(action: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    const repoPath = typeof inputs.path === 'string' ? inputs.path : undefined;

    switch (action) {
      case 'repo-info':
        return this.repoInfo(repoPath);

      case 'status-check':
        return this.statusCheck(repoPath);

      case 'branch-list':
        return this.branchList(repoPath);

      case 'log-inspect':
        return this.logInspect(
          repoPath,
          typeof inputs.count === 'number' ? inputs.count : 10,
          typeof inputs.since === 'string' ? inputs.since : undefined,
        );

      case 'diff-review':
        return this.diffReview(
          repoPath,
          typeof inputs.base === 'string' ? inputs.base : 'HEAD',
          typeof inputs.head === 'string' ? inputs.head : undefined,
        );

      case 'release-verify':
        return this.releaseInfo(repoPath);

      case 'changelog-prepare':
        return this.changelogPrepare(
          repoPath,
          typeof inputs.from === 'string' ? inputs.from : undefined,
          typeof inputs.to === 'string' ? inputs.to : 'HEAD',
        );

      case 'tag-create':
        return this.tagCreate(
          repoPath,
          String(inputs.name || ''),
          typeof inputs.message === 'string' ? inputs.message : undefined,
        );

      case 'push-commits':
        return this.pushCommits(
          repoPath,
          typeof inputs.remote === 'string' ? inputs.remote : 'origin',
          typeof inputs.branch === 'string' ? inputs.branch : undefined,
          Boolean(inputs.dryRun),
        );

      case 'push-tags':
        return this.pushTags(
          repoPath,
          typeof inputs.remote === 'string' ? inputs.remote : 'origin',
          typeof inputs.tag === 'string' ? inputs.tag : undefined,
          Boolean(inputs.dryRun),
        );

      case 'release-create':
        return this.releaseCreate(repoPath, {
          tag: String(inputs.tag || ''),
          title: String(inputs.title || ''),
          body: String(inputs.body || ''),
          draft: Boolean(inputs.draft),
          prerelease: Boolean(inputs.prerelease),
        });

      case 'branch-delete':
        return this.branchDelete(
          repoPath,
          String(inputs.branch || ''),
          Boolean(inputs.remote),
          Boolean(inputs.force),
        );

      default:
        throw new Error(`Unsupported or unimplemented action on GitHub bridge: "${action}"`);
    }
  }
}
