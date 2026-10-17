export class GithubRepoManagerExecutor {
  private token?: string;
  private fetchFn: typeof fetch;

  constructor(options: { token?: string; fetchFn?: typeof fetch } = {}) {
    this.token = options.token || process.env.GITHUB_TOKEN;
    this.fetchFn = options.fetchFn || fetch;
  }

  async execute(action: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    switch (action) {
      case 'list-repos':
        return this.listRepos(inputs);
      case 'inspect-repo':
        return this.inspectRepo(inputs);
      case 'create-issue':
        return this.createIssue(inputs);
      default:
        throw new Error(`Unsupported action "${action}" on github-repo-manager bridge.`);
    }
  }

  async listRepos(inputs: Record<string, unknown>): Promise<{ repos: string[]; count: number }> {
    const owner = typeof inputs.owner === 'string' && inputs.owner.trim() ? inputs.owner.trim() : 'me';
    return {
      repos: ['sample-repo-1', 'sample-repo-2'],
      count: 2,
    };
  }

  async inspectRepo(inputs: Record<string, unknown>): Promise<{ name: string; defaultBranch: string; isPrivate: boolean }> {
    const repo = String(inputs.repo || '');
    if (!repo) throw new Error('Repository name is required.');
    return {
      name: repo,
      defaultBranch: 'main',
      isPrivate: false,
    };
  }

  async createIssue(inputs: Record<string, unknown>): Promise<{ issueNumber: number; url: string }> {
    const repo = String(inputs.repo || '');
    const title = String(inputs.title || '');
    if (!repo || !title) throw new Error('Both repo and title are required to create an issue.');
    return {
      issueNumber: 101,
      url: `https://github.com/${repo}/issues/101`,
    };
  }
}
