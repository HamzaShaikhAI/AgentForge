import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import {
  createBuiltinAdapters,
  FilesystemAdapter,
  HttpAdapter,
  SqliteAdapter,
  MemoryAdapter,
  DockerAdapter,
  GitHubApiAdapter,
} from './index.js';
import { StandardStepExecutor } from '../executors/index.js';
import { WorkflowStep } from '../types.js';

describe('Native Integration Adapters & Adapter Contract (Phase 4)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-adapter-test-'));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('instantiates at least 20 native integration adapters implementing BaseIntegrationAdapter', () => {
    const adapters = createBuiltinAdapters();
    expect(adapters.length).toBeGreaterThanOrEqual(20);

    const names = new Set<string>();
    for (const adapter of adapters) {
      expect(adapter.name).toMatch(/^[a-z0-9-]+$/);
      expect(names.has(adapter.name)).toBe(false);
      names.add(adapter.name);

      expect(adapter.displayName.length).toBeGreaterThan(0);
      expect(adapter.description.length).toBeGreaterThan(0);
      expect(adapter.version).toBe('1.0.0');

      const actions = adapter.getActions();
      expect(actions.length).toBeGreaterThanOrEqual(1);

      for (const action of actions) {
        expect(action.action.length).toBeGreaterThan(0);
        expect(['read', 'local-write', 'external-write', 'publish', 'destructive']).toContain(action.permissionLevel);
        expect(typeof action.sideEffects).toBe('boolean');
        expect(typeof action.requiresApproval).toBe('boolean');
      }
    }
  });

  describe('FilesystemAdapter (Local Path Containment & Operations)', () => {
    it('reads and writes files within allowed directory boundary', async () => {
      const adapter = new FilesystemAdapter(tempDir);
      const testFile = join(tempDir, 'sample.txt');

      const writeRes = (await adapter.execute('write-file', {
        path: testFile,
        content: 'AgentForge Native Adapter Content',
      })) as { path: string; written: boolean };

      expect(writeRes.written).toBe(true);

      const readRes = (await adapter.execute('read-file', {
        path: testFile,
      })) as { content: string };

      expect(readRes.content).toBe('AgentForge Native Adapter Content');
    });

    it('enforces path boundary and blocks directory traversal attempts', async () => {
      const adapter = new FilesystemAdapter(tempDir);
      const escapePath = join(tempDir, '..', '..', 'Windows', 'System32', 'drivers', 'etc', 'hosts');

      await expect(adapter.execute('read-file', { path: escapePath })).rejects.toThrow(
        'Security Violation: Path'
      );
    });
  });

  describe('HttpAdapter (Outbound REST with SSRF Guards)', () => {
    it('blocks loopback / private IP requests when allowLoopback is false (SSRF Protection)', async () => {
      const adapter = new HttpAdapter({ allowLoopback: false });

      await expect(adapter.execute('get', { url: 'http://localhost:8080/admin' })).rejects.toThrow(
        'SSRF Protection: Outbound requests to private/loopback network address "localhost" are blocked'
      );

      await expect(adapter.execute('get', { url: 'http://127.0.0.1:9000/keys' })).rejects.toThrow(
        'SSRF Protection: Outbound requests to private/loopback network address "127.0.0.1" are blocked'
      );
    });

    it('rejects unsupported URI protocols', async () => {
      const adapter = new HttpAdapter();
      await expect(adapter.execute('get', { url: 'file:///etc/passwd' })).rejects.toThrow(
        'Protocol "file:" not supported'
      );
    });
  });

  describe('SqliteAdapter (Safe Query Routing)', () => {
    it('rejects write queries when invoked as read-query', async () => {
      const adapter = new SqliteAdapter();
      await expect(
        adapter.execute('read-query', {
          dbPath: 'test.db',
          sql: 'DROP TABLE users;',
        })
      ).rejects.toThrow('read-query only allows read-only queries');
    });

    it('executes valid read query and lists tables', async () => {
      const adapter = new SqliteAdapter();
      const res = (await adapter.execute('read-query', {
        dbPath: 'test.db',
        sql: 'SELECT id, name FROM users;',
      })) as { rowCount: number };
      expect(res.rowCount).toBe(0);

      const tablesRes = (await adapter.execute('list-tables', {
        dbPath: 'test.db',
      })) as { tables: string[] };
      expect(tablesRes.tables).toContain('sqlite_master');
    });
  });

  describe('MemoryAdapter (Knowledge Graph State)', () => {
    it('stores entities and queries graph contents', async () => {
      const adapter = new MemoryAdapter();
      await adapter.execute('add-entity', {
        name: 'AgentForge',
        type: 'runtime',
        platform: 'antigravity',
      });

      const graph = (await adapter.execute('query-graph', {})) as { count: number; entities: Array<{ name: string }> };
      expect(graph.count).toBe(1);
      expect(graph.entities[0].name).toBe('AgentForge');

      const search = (await adapter.execute('search-nodes', { query: 'agent' })) as { count: number };
      expect(search.count).toBe(1);
    });
  });

  describe('StandardStepExecutor Integration with Native Adapters', () => {
    it('automatically dispatches workflow steps to registered native adapters', async () => {
      const executor = new StandardStepExecutor();
      const testFile = join(tempDir, 'adapter-exec.txt');

      const step: WorkflowStep = {
        id: 'step-fs-write',
        name: 'Filesystem Write Step',
        bridge: 'filesystem',
        action: 'write-file',
        inputs: {
          path: testFile,
          content: 'Dispatched through StandardStepExecutor router',
        },
      };

      const result = (await executor.execute(step)) as { written: boolean };
      expect(result.written).toBe(true);

      const readStep: WorkflowStep = {
        id: 'step-fs-read',
        name: 'Filesystem Read Step',
        bridge: 'filesystem',
        action: 'read-file',
        inputs: {
          path: testFile,
        },
      };

      const readResult = (await executor.execute(readStep)) as { content: string };
      expect(readResult.content).toBe('Dispatched through StandardStepExecutor router');
    });
  });
});
