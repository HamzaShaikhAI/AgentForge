import { describe, it, expect, beforeEach } from 'vitest';
import { SupabaseAdapter } from './supabase.js';

describe('SupabaseAdapter', () => {
  let adapter: SupabaseAdapter;

  beforeEach(() => {
    adapter = new SupabaseAdapter();
  });

  it('exposes correct metadata and category', () => {
    expect(adapter.name).toBe('supabase');
    expect(adapter.displayName).toBe('Supabase Backend Cloud');
    expect(adapter.category).toBe('cloud-services');
    expect(adapter.version).toBe('1.0.0');
  });

  it('declares all expected actions including approval on delete', () => {
    const actions = adapter.getActions();
    const actionNames = actions.map(a => a.action);

    expect(actionNames).toContain('query-table');
    expect(actionNames).toContain('insert-record');
    expect(actionNames).toContain('update-record');
    expect(actionNames).toContain('delete-record');
    expect(actionNames).toContain('rpc-function');
    expect(actionNames).toContain('list-buckets');
    expect(actionNames).toContain('upload-file');
    expect(actionNames).toContain('list-auth-users');
    expect(actionNames).toContain('invoke-edge-function');
    expect(actionNames).toContain('inspect-schema');

    const del = actions.find(a => a.action === 'delete-record');
    expect(del?.requiresApproval).toBe(true);
    expect(del?.permissionLevel).toBe('destructive');
  });

  it('queries, inserts, updates, and deletes records', async () => {
    const query = await adapter.execute('query-table', { table: 'profiles', limit: 10 }) as any;
    expect(query.success).toBe(true);
    expect(query.data.length).toBeGreaterThan(0);

    const insert = await adapter.execute('insert-record', {
      table: 'profiles',
      record: { username: 'agentforge_user' },
    }) as any;
    expect(insert.success).toBe(true);
    expect(insert.inserted.username).toBe('agentforge_user');

    const update = await adapter.execute('update-record', {
      table: 'profiles',
      match: { id: 'sb_row_01' },
      values: { status: 'verified' },
    }) as any;
    expect(update.success).toBe(true);
    expect(update.affectedRows).toBe(1);

    const del = await adapter.execute('delete-record', {
      table: 'profiles',
      match: { id: 'sb_row_01' },
    }) as any;
    expect(del.success).toBe(true);
    expect(del.deleted).toBe(true);
  });

  it('manages storage buckets and invokes edge functions', async () => {
    const buckets = await adapter.execute('list-buckets', {}) as any;
    expect(buckets.success).toBe(true);
    expect(buckets.buckets.length).toBeGreaterThan(0);

    const upload = await adapter.execute('upload-file', {
      bucket: 'avatars',
      filePath: './avatar.png',
      destinationName: 'avatar.png',
    }) as any;
    expect(upload.success).toBe(true);
    expect(upload.publicUrl).toContain('supabase.co');

    const edge = await adapter.execute('invoke-edge-function', {
      functionName: 'send-welcome-email',
    }) as any;
    expect(edge.success).toBe(true);
    expect(edge.status).toBe(200);
  });

  it('inspects schema and lists auth users', async () => {
    const schema = await adapter.execute('inspect-schema', {}) as any;
    expect(schema.success).toBe(true);
    expect(schema.tables.length).toBeGreaterThan(0);

    const users = await adapter.execute('list-auth-users', {}) as any;
    expect(users.success).toBe(true);
    expect(users.users.length).toBeGreaterThan(0);
  });

  it('throws on missing required parameters', async () => {
    await expect(adapter.execute('query-table', {})).rejects.toThrow('query-table requires "table" parameter');
    await expect(adapter.execute('insert-record', { table: 'users' })).rejects.toThrow('insert-record requires "table" and "record"');
  });
});
