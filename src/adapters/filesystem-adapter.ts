import { BaseIntegrationAdapter, AdapterHealthResult, AdapterActionDefinition } from './base-adapter.js';
import { readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { resolve, normalize, join } from 'node:path';

export class FilesystemAdapter extends BaseIntegrationAdapter {
  readonly name = 'filesystem';
  readonly displayName = 'Local Filesystem';
  readonly description = 'Secure local filesystem adapter for reading, writing, listing, and inspecting files.';
  readonly version = '1.0.0';
  readonly category = 'productivity';

  private allowedBaseDir?: string;

  constructor(allowedBaseDir?: string) {
    super();
    if (allowedBaseDir) {
      this.allowedBaseDir = resolve(allowedBaseDir);
    }
  }

  getActions(): AdapterActionDefinition[] {
    return [
      {
        action: 'read-file',
        description: 'Read the UTF-8 text content of a file from disk',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'write-file',
        description: 'Write UTF-8 text content to a file on disk',
        permissionLevel: 'local-write',
        sideEffects: true,
        requiresApproval: false,
      },
      {
        action: 'list-dir',
        description: 'List file and folder names in a directory',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'stat-file',
        description: 'Inspect size, timestamps, and metadata of a path',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'delete-file',
        description: 'Delete a file from disk',
        permissionLevel: 'destructive',
        sideEffects: true,
        requiresApproval: true,
      },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    try {
      const target = this.allowedBaseDir || process.cwd();
      const s = await stat(target);
      return {
        healthy: s.isDirectory(),
        status: 'available',
        message: `Filesystem adapter accessible at ${target}`,
      };
    } catch (err) {
      return {
        healthy: false,
        status: 'error',
        message: `Filesystem access error: ${(err as Error).message}`,
      };
    }
  }

  private resolvePath(userPath: string): string {
    const resolved = resolve(normalize(userPath));
    if (this.allowedBaseDir) {
      if (!resolved.startsWith(this.allowedBaseDir)) {
        throw new Error(`Security Violation: Path "${userPath}" is outside allowed root "${this.allowedBaseDir}"`);
      }
    }
    return resolved;
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'read-file') {
      const filePath = inputs.path as string;
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('read-file requires a string for "path"');
      }
      const fullPath = this.resolvePath(filePath);
      const content = await readFile(fullPath, 'utf-8');
      return { path: fullPath, content, size: content.length };
    }

    if (action === 'write-file') {
      const filePath = inputs.path as string;
      const content = inputs.content;
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('write-file requires a string for "path"');
      }
      if (content === undefined || content === null) {
        throw new Error('write-file requires "content"');
      }
      const fullPath = this.resolvePath(filePath);
      const strContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      await writeFile(fullPath, strContent, 'utf-8');
      return { path: fullPath, bytesWritten: Buffer.byteLength(strContent, 'utf-8'), written: true };
    }

    if (action === 'list-dir') {
      const dirPath = (inputs.path as string) || (this.allowedBaseDir || process.cwd());
      const fullPath = this.resolvePath(dirPath);
      const entries = await readdir(fullPath);
      return { path: fullPath, entries, count: entries.length };
    }

    if (action === 'stat-file') {
      const filePath = inputs.path as string;
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('stat-file requires a string for "path"');
      }
      const fullPath = this.resolvePath(filePath);
      const s = await stat(fullPath);
      return {
        path: fullPath,
        size: s.size,
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        modifiedAt: s.mtime.toISOString(),
      };
    }

    if (action === 'delete-file') {
      const filePath = inputs.path as string;
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('delete-file requires a string for "path"');
      }
      const fullPath = this.resolvePath(filePath);
      await unlink(fullPath);
      return { path: fullPath, deleted: true };
    }

    throw new Error(`Unsupported action "${action}" on FilesystemAdapter`);
  }
}
