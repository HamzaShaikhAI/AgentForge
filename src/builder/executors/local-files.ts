import { readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';

export class LocalProjectFilesExecutor {
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
      throw new Error(`Path traversal violation: "${userPath}" is outside allowed directory "${this.baseDir}".`);
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
        throw new Error(`Unsupported action "${action}" on local-project-files bridge.`);
    }
  }

  async listFiles(inputs: Record<string, unknown>): Promise<{ files: string[]; count: number }> {
    const rawDir = typeof inputs.directory === 'string' ? inputs.directory : '.';
    const targetDir = this.resolveSafePath(rawDir);
    if (!existsSync(targetDir)) {
      throw new Error(`Directory does not exist: "${rawDir}".`);
    }
    const entries = await readdir(targetDir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);
    return { files, count: files.length };
  }

  async readFileContent(inputs: Record<string, unknown>): Promise<{ content: string; size: number }> {
    const rawPath = String(inputs.filePath || '');
    const safePath = this.resolveSafePath(rawPath);
    if (!existsSync(safePath)) {
      throw new Error(`File does not exist: "${rawPath}".`);
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
      throw new Error(`Target file does not exist: "${rawPath}".`);
    }
    await unlink(safePath);
    return { deleted: true, path: rawPath };
  }
}
