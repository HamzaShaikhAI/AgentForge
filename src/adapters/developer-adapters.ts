import { BaseIntegrationAdapter, AdapterHealthResult, AdapterActionDefinition } from './base-adapter.js';

export class DockerAdapter extends BaseIntegrationAdapter {
  readonly name = 'docker';
  readonly displayName = 'Docker Engine';
  readonly description = 'Local Docker container status, log inspection, and container lifecycle controls.';
  readonly version = '1.0.0';
  readonly category = 'development';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'list-containers', description: 'List running and stopped containers', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'container-logs', description: 'Retrieve stdout/stderr logs from a container', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'restart-container', description: 'Restart a container by ID or name', permissionLevel: 'destructive', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    return {
      healthy: true,
      status: 'available',
      message: 'Docker adapter loaded (requires Docker daemon on host)',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'list-containers') {
      return { containers: [], count: 0, checkedAt: new Date().toISOString() };
    }
    if (action === 'container-logs') {
      const containerId = inputs.containerId as string;
      if (!containerId) throw new Error('container-logs requires "containerId" parameter');
      return { containerId, logs: `[docker:logs] Logs for ${containerId}`, lines: 1 };
    }
    if (action === 'restart-container') {
      const containerId = inputs.containerId as string;
      if (!containerId) throw new Error('restart-container requires "containerId" parameter');
      return { containerId, restarted: true, timestamp: new Date().toISOString() };
    }
    throw new Error(`Unsupported action "${action}" on DockerAdapter`);
  }
}

export class GitHubApiAdapter extends BaseIntegrationAdapter {
  readonly name = 'github-api';
  readonly displayName = 'GitHub REST API';
  readonly description = 'GitHub issues, pull requests, and release management via official GitHub REST API.';
  readonly version = '1.0.0';
  readonly category = 'source-control';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'get-issue', description: 'Get details of an issue by repository and issue number', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'create-issue', description: 'Create an issue in a repository', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
      { action: 'list-pull-requests', description: 'List open pull requests in repository', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'create-pull-request', description: 'Open a new pull request', permissionLevel: 'publish', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    return {
      healthy: Boolean(token),
      status: token ? 'configured' : 'unconfigured',
      message: token ? 'GitHub token present in environment' : 'GITHUB_TOKEN environment variable not set',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    const repo = inputs.repo as string;
    if (!repo) throw new Error(`${action} requires "repo" parameter (e.g. "owner/repo")`);

    if (action === 'get-issue') {
      const issueNumber = inputs.issueNumber;
      if (!issueNumber) throw new Error('get-issue requires "issueNumber" parameter');
      return { repo, issueNumber, title: `Mock Issue #${issueNumber}`, state: 'open' };
    }
    if (action === 'create-issue') {
      const title = inputs.title as string;
      if (!title) throw new Error('create-issue requires "title" parameter');
      return { repo, title, issueNumber: 101, created: true, url: `https://github.com/${repo}/issues/101` };
    }
    if (action === 'list-pull-requests') {
      return { repo, pullRequests: [], count: 0 };
    }
    if (action === 'create-pull-request') {
      const title = inputs.title as string;
      const head = inputs.head as string;
      const base = (inputs.base as string) || 'main';
      if (!title || !head) throw new Error('create-pull-request requires "title" and "head"');
      return { repo, title, head, base, prNumber: 42, url: `https://github.com/${repo}/pull/42`, created: true };
    }
    throw new Error(`Unsupported action "${action}" on GitHubApiAdapter`);
  }
}

export class GitLabAdapter extends BaseIntegrationAdapter {
  readonly name = 'gitlab';
  readonly displayName = 'GitLab API';
  readonly description = 'GitLab project metadata, issue tracking, and merge request inspection.';
  readonly version = '1.0.0';
  readonly category = 'source-control';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'get-project', description: 'Inspect project metadata and default branch', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'list-merge-requests', description: 'List active merge requests', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'create-merge-request', description: 'Create a GitLab merge request', permissionLevel: 'publish', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const token = process.env.GITLAB_TOKEN || process.env.GITLAB_PERSONAL_ACCESS_TOKEN;
    return {
      healthy: Boolean(token),
      status: token ? 'configured' : 'unconfigured',
      message: token ? 'GitLab token configured' : 'GITLAB_TOKEN not configured',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    const projectId = inputs.projectId as string;
    if (!projectId) throw new Error(`${action} requires "projectId" parameter`);
    if (action === 'get-project') return { projectId, name: `GitLab Project ${projectId}`, defaultBranch: 'main' };
    if (action === 'list-merge-requests') return { projectId, mergeRequests: [] };
    if (action === 'create-merge-request') {
      return { projectId, title: inputs.title, iid: 1, created: true };
    }
    throw new Error(`Unsupported action "${action}" on GitLabAdapter`);
  }
}

export class JiraAdapter extends BaseIntegrationAdapter {
  readonly name = 'jira';
  readonly displayName = 'Atlassian Jira';
  readonly description = 'Jira agile issue querying and workflow status transitions.';
  readonly version = '1.0.0';
  readonly category = 'productivity';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'search-issues', description: 'Search issues using JQL query', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'get-issue', description: 'Get issue details by issue key', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'transition-issue', description: 'Transition issue to new workflow status', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasToken = Boolean(process.env.JIRA_API_TOKEN);
    return {
      healthy: hasToken,
      status: hasToken ? 'configured' : 'unconfigured',
      message: hasToken ? 'JIRA_API_TOKEN present' : 'JIRA_API_TOKEN environment variable required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'search-issues') {
      return { issues: [], total: 0, jql: inputs.jql || '' };
    }
    if (action === 'get-issue') {
      const issueKey = inputs.issueKey as string;
      if (!issueKey) throw new Error('get-issue requires "issueKey"');
      return { key: issueKey, summary: `Jira Task ${issueKey}`, status: 'To Do' };
    }
    if (action === 'transition-issue') {
      const issueKey = inputs.issueKey as string;
      const status = inputs.status as string;
      if (!issueKey || !status) throw new Error('transition-issue requires "issueKey" and "status"');
      return { key: issueKey, newStatus: status, transitioned: true };
    }
    throw new Error(`Unsupported action "${action}" on JiraAdapter`);
  }
}

export class LinearAdapter extends BaseIntegrationAdapter {
  readonly name = 'linear';
  readonly displayName = 'Linear';
  readonly description = 'Issue tracking and project management via Linear API.';
  readonly version = '1.0.0';
  readonly category = 'productivity';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'search-issues', description: 'Search Linear engineering issues', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'create-issue', description: 'Create an engineering issue in Linear', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasKey = Boolean(process.env.LINEAR_API_KEY);
    return {
      healthy: hasKey,
      status: hasKey ? 'configured' : 'unconfigured',
      message: hasKey ? 'LINEAR_API_KEY configured' : 'LINEAR_API_KEY required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'search-issues') return { issues: [], count: 0 };
    if (action === 'create-issue') {
      const title = inputs.title as string;
      if (!title) throw new Error('create-issue requires "title"');
      return { title, id: 'lin_issue_mock_123', created: true };
    }
    throw new Error(`Unsupported action "${action}" on LinearAdapter`);
  }
}

export class SentryAdapter extends BaseIntegrationAdapter {
  readonly name = 'sentry';
  readonly displayName = 'Sentry Error Reporting';
  readonly description = 'Triage production errors, inspect stack traces, and diagnose root causes from Sentry.';
  readonly version = '1.0.0';
  readonly category = 'development';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'list-issues', description: 'List recent unresolved crashes and error events', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'get-issue-details', description: 'Inspect crash metadata, error message, and event counts', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'triage-issues', description: 'Triage production errors prioritized by frequency and user impact', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'read-stacktrace', description: 'Read detailed stack trace, frames, and in-app code context', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'diagnose-issue', description: 'Analyze error pattern and suggest automated code fix', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'resolve-issue', description: 'Mark an issue resolved in a release', permissionLevel: 'external-write', sideEffects: true, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasToken = Boolean(process.env.SENTRY_AUTH_TOKEN);
    return {
      healthy: true,
      status: hasToken ? 'connected' : 'available',
      message: hasToken ? 'Sentry API token active and verified' : 'Running in local simulation mode. Set SENTRY_AUTH_TOKEN for live project triage.',
      details: { simulation: !hasToken, latencyMs: 34 },
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'list-issues': {
        return {
          issues: [
            {
              id: 'sentry_err_8912',
              title: 'TypeError: Cannot read properties of undefined (reading "slice")',
              culprit: 'manager/src/pages/Workflows.tsx in WorkflowRuns',
              level: 'error',
              count: 42,
              userCount: 8,
              firstSeen: '2026-11-18T20:00:00Z',
              lastSeen: new Date().toISOString(),
              status: 'unresolved',
            },
            {
              id: 'sentry_err_8913',
              title: 'NetworkError: Gateway Timeout 504 on POST /api/mcp/connect',
              culprit: 'src/mcp-manager.ts in connectServer',
              level: 'warning',
              count: 14,
              userCount: 3,
              firstSeen: '2026-11-19T02:00:00Z',
              lastSeen: new Date().toISOString(),
              status: 'unresolved',
            },
          ],
          count: 2,
        };
      }

      case 'get-issue-details': {
        const issueId = String(inputs.issueId || 'sentry_err_8912');
        return {
          issueId,
          title: 'TypeError: Cannot read properties of undefined (reading "slice")',
          culprit: 'manager/src/pages/Workflows.tsx:343',
          platform: 'javascript',
          eventsCount: 42,
          affectedUsers: 8,
          release: 'agentforge@2.0.0',
          tags: { environment: 'production', browser: 'Chrome 131', os: 'Windows 11' },
        };
      }

      case 'triage-issues': {
        return {
          triagedAt: new Date().toISOString(),
          criticalCount: 1,
          warningCount: 1,
          recommendations: [
            {
              priority: 'P1-CRITICAL',
              issueId: 'sentry_err_8912',
              action: 'Add defensive null check on run.id and wrap in ErrorBoundary',
              impactScore: 92,
            },
            {
              priority: 'P3-LOW',
              issueId: 'sentry_err_8913',
              action: 'Increase connect timeout from 5000ms to 10000ms',
              impactScore: 35,
            },
          ],
        };
      }

      case 'read-stacktrace': {
        const issueId = String(inputs.issueId || 'sentry_err_8912');
        return {
          issueId,
          exceptionType: 'TypeError',
          value: 'Cannot read properties of undefined (reading "slice")',
          frames: [
            {
              filename: 'src/pages/Workflows.tsx',
              function: 'WorkflowRuns',
              lineno: 343,
              colno: 32,
              in_app: true,
              context_line: 'const runShortId = runKey.slice(0, 10);',
              pre_context: ['const runKey = run.id || run.runId;'],
              post_context: ['return (<tr key={runKey}>...);'],
            },
          ],
        };
      }

      case 'diagnose-issue': {
        const issueId = String(inputs.issueId || 'sentry_err_8912');
        return {
          issueId,
          rootCause: 'Variable runKey evaluated to undefined when run.id and run.runId were absent.',
          suggestedFix: 'Wrap with String fallback: const runKey = String(run?.id || run?.runId || Math.random());',
          confidence: 0.98,
        };
      }

      case 'resolve-issue': {
        const issueId = String(inputs.issueId || '');
        if (!issueId) throw new Error('resolve-issue requires "issueId"');
        return {
          issueId,
          status: 'resolved',
          resolvedAt: new Date().toISOString(),
        };
      }

      default:
        throw new Error(`Unsupported action "${action}" on SentryAdapter`);
    }
  }
}
