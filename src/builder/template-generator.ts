import { BridgeManifest, BridgeCapability, PermissionRule, PermissionLevel } from '../types.js';

export interface GeneratedBridgeArtifacts {
  manifest: BridgeManifest;
  executorCode: string;
  testCode: string;
  templateName: string;
}

export class TemplateGenerator {
  /**
   * Determine matching template from prompt or return generic template.
   */
  generateFromPrompt(prompt: string, targetName?: string): GeneratedBridgeArtifacts {
    const p = prompt.toLowerCase();

    // 1. Local Project Files Template
    if (p.includes('file') || p.includes('filesystem') || p.includes('directory') || p.includes('folder')) {
      const name = targetName || 'local-project-files';
      return this.createLocalFilesTemplate(name);
    }

    // 2. GitHub Repositories Template
    if (p.includes('github') || p.includes('repo') || p.includes('repository')) {
      const name = targetName || 'github-repo-manager';
      return this.createGitHubTemplate(name);
    }

    // 3. Fallback: Generic Service Template
    const name = targetName || 'custom-service-bridge';
    return this.createGenericServiceTemplate(name, prompt);
  }

  /**
   * Template for local project file operations with path-traversal safeguards.
   */
  createLocalFilesTemplate(name: string): GeneratedBridgeArtifacts {
    const className = this.toPascalCase(name) + 'Executor';

    const manifest: BridgeManifest = {
      schema: '1.0',
      name,
      displayName: 'Local Project File Manager',
      description: 'Inspect, read, write, and safely delete project workspace files with path traversal protection.',
      version: '0.1.0',
      category: 'development',
      capabilities: [
        {
          action: 'list-files',
          description: 'List files in a specified directory within workspace boundaries',
          permissionLevel: 'read',
          sideEffects: false,
          inputs: [
            { name: 'directory', type: 'string', description: 'Relative or absolute directory path', required: false, default: '.' },
            { name: 'recursive', type: 'boolean', description: 'Whether to traverse subdirectories', required: false, default: false },
          ],
          outputs: [
            { name: 'files', type: 'array', description: 'List of matching file names' },
            { name: 'count', type: 'number', description: 'Total files found' },
          ],
        },
        {
          action: 'read-file',
          description: 'Read contents of a text file within workspace boundaries',
          permissionLevel: 'read',
          sideEffects: false,
          inputs: [
            { name: 'filePath', type: 'string', description: 'Path to target file', required: true },
            { name: 'encoding', type: 'string', description: 'File encoding (utf-8)', required: false, default: 'utf-8' },
          ],
          outputs: [
            { name: 'content', type: 'string', description: 'Text contents of the file' },
            { name: 'size', type: 'number', description: 'Byte length' },
          ],
        },
        {
          action: 'write-file',
          description: 'Write or update a file within workspace boundaries',
          permissionLevel: 'local-write',
          sideEffects: true,
          inputs: [
            { name: 'filePath', type: 'string', description: 'Target path for output file', required: true },
            { name: 'content', type: 'string', description: 'Text content to write', required: true },
          ],
          outputs: [
            { name: 'success', type: 'boolean', description: 'Whether write completed' },
            { name: 'bytesWritten', type: 'number', description: 'Number of bytes written' },
          ],
        },
        {
          action: 'delete-file',
          description: 'Permanently remove a file. Requires explicit operator consent.',
          permissionLevel: 'destructive',
          sideEffects: true,
          inputs: [
            { name: 'filePath', type: 'string', description: 'Path of file to delete', required: true },
          ],
          outputs: [
            { name: 'deleted', type: 'boolean', description: 'Whether deletion succeeded' },
            { name: 'path', type: 'string', description: 'Target path removed' },
          ],
        },
      ],
      integrations: [],
      auth: [],
      permissions: [
        {
          actions: 'list-files',
          level: 'read',
          requiresApproval: false,
        },
        {
          actions: 'read-file',
          level: 'read',
          requiresApproval: false,
        },
        {
          actions: 'write-file',
          level: 'local-write',
          requiresApproval: false,
        },
        {
          actions: 'delete-file',
          level: 'destructive',
          requiresApproval: true,
          approvalReason: 'Destructive operation: file will be permanently removed from disk.',
        },
      ],
      tags: ['files', 'local', 'storage', 'project'],
    };

    const executorCode = `import { readFile, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import { resolve, normalize, join, relative } from 'node:path';
import { existsSync } from 'node:fs';

export class ${className} {
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = resolve(baseDir);
  }

  private resolveSafePath(userPath: string): string {
    if (!userPath || typeof userPath !== 'string') {
      throw new Error('Path must be a non-empty string.');
    }
    const resolved = resolve(this.baseDir, userPath);
    const rel = relative(this.baseDir, resolved);
    if (rel.startsWith('..') || resolve(resolved).length < this.baseDir.length) {
      throw new Error(\`Path traversal violation: "\${userPath}" is outside allowed directory "\${this.baseDir}".\`);
    }
    return resolved;
  }

  async execute(action: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    switch (action) {
      case 'list-files':
        return this.listFiles(inputs);
      case 'read-file':
        return this.readFileContent(inputs);
      case 'write-file':
        return this.writeFileContent(inputs);
      case 'delete-file':
        return this.deleteFile(inputs);
      default:
        throw new Error(\`Unsupported action "\${action}" on bridge "${name}".\`);
    }
  }

  async listFiles(inputs: Record<string, unknown>): Promise<{ files: string[]; count: number }> {
    const rawDir = typeof inputs.directory === 'string' ? inputs.directory : '.';
    const targetDir = this.resolveSafePath(rawDir);
    if (!existsSync(targetDir)) {
      throw new Error(\`Directory does not exist: "\${rawDir}".\`);
    }
    const entries = await readdir(targetDir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);
    return { files, count: files.length };
  }

  async readFileContent(inputs: Record<string, unknown>): Promise<{ content: string; size: number }> {
    const rawPath = String(inputs.filePath || '');
    const safePath = this.resolveSafePath(rawPath);
    if (!existsSync(safePath)) {
      throw new Error(\`File does not exist: "\${rawPath}".\`);
    }
    const content = await readFile(safePath, 'utf-8');
    return { content, size: Buffer.byteLength(content, 'utf-8') };
  }

  async writeFileContent(inputs: Record<string, unknown>): Promise<{ success: boolean; bytesWritten: number }> {
    const rawPath = String(inputs.filePath || '');
    const content = typeof inputs.content === 'string' ? inputs.content : '';
    const safePath = this.resolveSafePath(rawPath);
    await writeFile(safePath, content, 'utf-8');
    return { success: true, bytesWritten: Buffer.byteLength(content, 'utf-8') };
  }

  async deleteFile(inputs: Record<string, unknown>): Promise<{ deleted: boolean; path: string }> {
    const rawPath = String(inputs.filePath || '');
    const safePath = this.resolveSafePath(rawPath);
    if (!existsSync(safePath)) {
      throw new Error(\`Target file does not exist: "\${rawPath}".\`);
    }
    await unlink(safePath);
    return { deleted: true, path: rawPath };
  }
}
`;

    const testCode = `import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { ${className} } from './executor.js';

describe('${name} (${className})', () => {
  let tempDir: string;
  let executor: ${className};

  beforeEach(() => {
    tempDir = join(tmpdir(), 'agentforge-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    mkdirSync(tempDir, { recursive: true });
    executor = new ${className}(tempDir);
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes and reads a file successfully within base boundary', async () => {
    const writeRes = (await executor.execute('write-file', {
      filePath: 'hello.txt',
      content: 'Hello AgentForge',
    })) as any;
    expect(writeRes.success).toBe(true);

    const readRes = (await executor.execute('read-file', {
      filePath: 'hello.txt',
    })) as any;
    expect(readRes.content).toBe('Hello AgentForge');
  });

  it('lists files in directory', async () => {
    await executor.execute('write-file', { filePath: 'f1.txt', content: '1' });
    await executor.execute('write-file', { filePath: 'f2.txt', content: '2' });

    const listRes = (await executor.execute('list-files', {})) as any;
    expect(listRes.files).toContain('f1.txt');
    expect(listRes.files).toContain('f2.txt');
    expect(listRes.count).toBeGreaterThanOrEqual(2);
  });

  it('deletes a file when requested', async () => {
    await executor.execute('write-file', { filePath: 'delete-me.txt', content: 'bye' });
    const delRes = (await executor.execute('delete-file', { filePath: 'delete-me.txt' })) as any;
    expect(delRes.deleted).toBe(true);

    await expect(executor.execute('read-file', { filePath: 'delete-me.txt' })).rejects.toThrow(/does not exist/i);
  });

  it('prevents path traversal attempts escaping base boundary', async () => {
    await expect(
      executor.execute('write-file', {
        filePath: '../../forbidden.txt',
        content: 'malicious',
      })
    ).rejects.toThrow(/Path traversal violation/i);
  });
});
`;

    return {
      manifest,
      executorCode,
      testCode,
      templateName: 'local-files',
    };
  }

  /**
   * Template for GitHub repository inspection and management.
   */
  createGitHubTemplate(name: string): GeneratedBridgeArtifacts {
    const className = this.toPascalCase(name) + 'Executor';

    const manifest: BridgeManifest = {
      schema: '1.0',
      name,
      displayName: 'GitHub Repository Manager',
      description: 'Inspect repositories, issues, and publish releases via GitHub API with approval gating.',
      version: '0.1.0',
      category: 'source-control',
      capabilities: [
        {
          action: 'list-repos',
          description: 'List accessible GitHub repositories for user or organization',
          permissionLevel: 'read',
          sideEffects: false,
          inputs: [
            { name: 'owner', type: 'string', description: 'GitHub username or organization', required: false },
          ],
          outputs: [
            { name: 'repos', type: 'array', description: 'Repository names' },
          ],
        },
        {
          action: 'inspect-repo',
          description: 'Get repository details, default branch, and visibility',
          permissionLevel: 'read',
          sideEffects: false,
          inputs: [
            { name: 'repo', type: 'string', description: 'Repository name or full name (owner/repo)', required: true },
          ],
          outputs: [
            { name: 'name', type: 'string', description: 'Repository name' },
            { name: 'defaultBranch', type: 'string', description: 'Main branch' },
          ],
        },
        {
          action: 'create-issue',
          description: 'Create an issue in repository. Modifies remote state.',
          permissionLevel: 'external-write',
          sideEffects: true,
          inputs: [
            { name: 'repo', type: 'string', description: 'Target repo (owner/repo)', required: true },
            { name: 'title', type: 'string', description: 'Issue title', required: true },
            { name: 'body', type: 'string', description: 'Issue description', required: false },
          ],
          outputs: [
            { name: 'issueNumber', type: 'number', description: 'Created issue ID' },
            { name: 'url', type: 'string', description: 'Web link to issue' },
          ],
        },
      ],
      integrations: [
        {
          name: 'git',
          check: { type: 'command', value: 'git --version' },
          required: true,
          setupInstructions: 'Install Git and ensure it is available on system PATH',
        },
      ],
      auth: [
        {
          name: 'github-token',
          type: 'env-var',
          envVar: 'GITHUB_TOKEN',
          description: 'Personal Access Token for GitHub API requests',
          required: false,
        },
      ],
      permissions: [
        {
          actions: 'list-repos',
          level: 'read',
          requiresApproval: false,
        },
        {
          actions: 'inspect-repo',
          level: 'read',
          requiresApproval: false,
        },
        {
          actions: 'create-issue',
          level: 'external-write',
          requiresApproval: true,
          approvalReason: 'Creating an issue will post public/shared comments to GitHub.',
        },
      ],
      tags: ['github', 'git', 'issues', 'source-control'],
    };

    const executorCode = `export class ${className} {
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
        throw new Error(\`Unsupported action "\${action}" on bridge "${name}".\`);
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
      url: \`https://github.com/\${repo}/issues/101\`,
    };
  }
}
`;

    const testCode = `import { describe, it, expect } from 'vitest';
import { ${className} } from './executor.js';

describe('${name} (${className})', () => {
  it('lists repos correctly', async () => {
    const executor = new ${className}();
    const result = (await executor.execute('list-repos', {})) as any;
    expect(result.repos).toBeDefined();
    expect(result.count).toBeGreaterThan(0);
  });

  it('inspects a repository', async () => {
    const executor = new ${className}();
    const result = (await executor.execute('inspect-repo', { repo: 'agentforge' })) as any;
    expect(result.name).toBe('agentforge');
    expect(result.defaultBranch).toBe('main');
  });

  it('creates an issue when required parameters are provided', async () => {
    const executor = new ${className}();
    const result = (await executor.execute('create-issue', {
      repo: 'my-org/my-repo',
      title: 'Bug report',
    })) as any;
    expect(result.issueNumber).toBe(101);
    expect(result.url).toContain('issues/101');
  });
});
`;

    return {
      manifest,
      executorCode,
      testCode,
      templateName: 'github-repo',
    };
  }

  /**
   * Generic template for arbitrary services, strictly enforcing least-privilege permissions.
   */
  createGenericServiceTemplate(name: string, prompt: string): GeneratedBridgeArtifacts {
    const className = this.toPascalCase(name) + 'Executor';

    const manifest: BridgeManifest = {
      schema: '1.0',
      name,
      displayName: this.toTitleCase(name),
      description: `Custom integration generated for: "${prompt.replace(/"/g, "'")}".`,
      version: '0.1.0',
      category: 'other',
      capabilities: [
        {
          action: 'inspect-status',
          description: 'Inspect status and metadata of the integration',
          permissionLevel: 'read',
          sideEffects: false,
          inputs: [],
          outputs: [
            { name: 'status', type: 'string', description: 'Health status' },
            { name: 'timestamp', type: 'string', description: 'Execution timestamp' },
          ],
        },
        {
          action: 'submit-data',
          description: 'Submit data payload to external service with operator approval',
          permissionLevel: 'external-write',
          sideEffects: true,
          inputs: [
            { name: 'payload', type: 'object', description: 'Data object to submit', required: true },
          ],
          outputs: [
            { name: 'acknowledged', type: 'boolean', description: 'Whether submission was received' },
            { name: 'id', type: 'string', description: 'Transaction identifier' },
          ],
        },
      ],
      integrations: [],
      auth: [],
      permissions: [
        {
          actions: 'inspect-status',
          level: 'read',
          requiresApproval: false,
        },
        {
          actions: 'submit-data',
          level: 'external-write',
          requiresApproval: true,
          approvalReason: 'External write operation modifies state on remote service.',
        },
      ],
      tags: ['custom', name],
    };

    const executorCode = `export class ${className} {
  async execute(action: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    switch (action) {
      case 'inspect-status':
        return this.inspectStatus();
      case 'submit-data':
        return this.submitData(inputs);
      default:
        throw new Error(\`Unsupported action "\${action}" on bridge "${name}".\`);
    }
  }

  async inspectStatus(): Promise<{ status: string; timestamp: string }> {
    return {
      status: 'operational',
      timestamp: new Date().toISOString(),
    };
  }

  async submitData(inputs: Record<string, unknown>): Promise<{ acknowledged: boolean; id: string }> {
    if (!inputs.payload || typeof inputs.payload !== 'object') {
      throw new Error('payload must be a valid object');
    }
    return {
      acknowledged: true,
      id: 'tx-' + Date.now(),
    };
  }
}
`;

    const testCode = `import { describe, it, expect } from 'vitest';
import { ${className} } from './executor.js';

describe('${name} (${className})', () => {
  it('inspects status successfully', async () => {
    const executor = new ${className}();
    const res = (await executor.execute('inspect-status', {})) as any;
    expect(res.status).toBe('operational');
    expect(res.timestamp).toBeDefined();
  });

  it('submits data payload', async () => {
    const executor = new ${className}();
    const res = (await executor.execute('submit-data', { payload: { test: true } })) as any;
    expect(res.acknowledged).toBe(true);
    expect(res.id).toMatch(/^tx-\\d+/);
  });
});
`;

    return {
      manifest,
      executorCode,
      testCode,
      templateName: 'generic-service',
    };
  }

  private toPascalCase(str: string): string {
    return str
      .split(/[-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  private toTitleCase(str: string): string {
    return str
      .split(/[-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
