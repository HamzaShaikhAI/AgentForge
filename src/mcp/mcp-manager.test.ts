import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { McpManager } from './mcp-manager.js';
import { MemoryCredentialStore } from '../auth/index.js';
import { inferToolPermission } from './types.js';

describe('inferToolPermission', () => {
  it('correctly categorizes read-only tools', () => {
    const perm1 = inferToolPermission('get_weather', 'Get current weather data');
    expect(perm1.level).toBe('read');
    expect(perm1.requiresApproval).toBe(false);

    const perm2 = inferToolPermission('search_repositories', 'Find repositories matching query');
    expect(perm2.level).toBe('read');
    expect(perm2.requiresApproval).toBe(false);

    const perm3 = inferToolPermission('inspect_container', 'Inspect docker container state');
    expect(perm3.level).toBe('read');
    expect(perm3.requiresApproval).toBe(false);
  });

  it('correctly categorizes write tools', () => {
    const perm1 = inferToolPermission('write_file', 'Write content to disk');
    expect(perm1.level).toBe('local-write');
    expect(perm1.requiresApproval).toBe(false);

    const perm2 = inferToolPermission('update_database_record', 'Update row in database');
    expect(perm2.level).toBe('external-write');
    expect(perm2.requiresApproval).toBe(true);
  });

  it('correctly categorizes destructive tools as requiring approval', () => {
    const perm1 = inferToolPermission('delete_branch', 'Permanently delete a branch');
    expect(perm1.level).toBe('destructive');
    expect(perm1.requiresApproval).toBe(true);

    const perm2 = inferToolPermission('drop_table', 'Drop SQL table');
    expect(perm2.level).toBe('destructive');
    expect(perm2.requiresApproval).toBe(true);
  });

  it('correctly categorizes publish/deploy tools as requiring approval', () => {
    const perm1 = inferToolPermission('publish_npm_package', 'Publish package to npm registry');
    expect(perm1.level).toBe('publish');
    expect(perm1.requiresApproval).toBe(true);

    const perm2 = inferToolPermission('deploy_lambda', 'Deploy code to cloud function');
    expect(perm2.level).toBe('publish');
    expect(perm2.requiresApproval).toBe(true);
  });
});

describe('McpManager & Stdio MCP Client Lifecycle', () => {
  let tempStoragePath: string;
  let credentialStore: MemoryCredentialStore;
  let manager: McpManager;

  beforeEach(() => {
    tempStoragePath = join(tmpdir(), `test-agentforge-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    credentialStore = new MemoryCredentialStore();
    manager = new McpManager({ storagePath: tempStoragePath, credentialStore });
  });

  afterEach(async () => {
    await manager.disconnectAll();
    if (existsSync(tempStoragePath)) {
      try {
        rmSync(tempStoragePath);
      } catch {
        // ignore cleanup error
      }
    }
  });

  it('validates server configuration schemas on addition', async () => {
    // Missing id
    await expect(manager.addServer({ id: '', name: 'Test', transport: 'stdio', command: 'node' })).rejects.toThrow('Invalid server ID');

    // Invalid id format
    await expect(manager.addServer({ id: 'bad id with spaces!', name: 'Test', transport: 'stdio', command: 'node' })).rejects.toThrow('alphanumeric');

    // Missing transport
    await expect(manager.addServer({ id: 'srv1', name: 'Test', transport: 'invalid' as any })).rejects.toThrow('transport');

    // Stdio without command
    await expect(manager.addServer({ id: 'srv1', name: 'Test', transport: 'stdio' })).rejects.toThrow('command cannot be empty');

    // HTTP without url
    await expect(manager.addServer({ id: 'srv1', name: 'Test', transport: 'http' })).rejects.toThrow('URL cannot be empty');

    // HTTP with invalid url
    await expect(manager.addServer({ id: 'srv1', name: 'Test', transport: 'http', url: 'not-a-url' })).rejects.toThrow('Invalid MCP server URL');
  });

  it('persists and redacts secrets in server state', async () => {
    await manager.addServer({
      id: 'secret-server',
      name: 'Server With Secrets',
      transport: 'stdio',
      command: 'node',
      env: {
        SAFE_SETTING: 'public_value',
        API_KEY: 'sk-1234567890abcdef',
        MY_SECRET_TOKEN: 'top-secret',
      },
      autoConnect: false,
    });

    const state = manager.getServerState('secret-server');
    expect(state).toBeDefined();
    expect(state?.status).toBe('disconnected');

    // Check secrets are redacted in getState()
    expect(state?.env?.SAFE_SETTING).toBe('public_value');
    expect(state?.env?.API_KEY).toBe('[REDACTED]');
    expect(state?.env?.MY_SECRET_TOKEN).toBe('[REDACTED]');

    // Reloading manager loads persisted config
    const reloadedManager = new McpManager({ storagePath: tempStoragePath, credentialStore });
    await reloadedManager.loadConfiguredServers();
    const reloadedState = reloadedManager.getServerState('secret-server');
    expect(reloadedState).toBeDefined();
    expect(reloadedState?.name).toBe('Server With Secrets');
  });

  it('spawns a real stdio MCP server, connects, discovers tools, and handles ping', async () => {
    // Inline script that responds to MCP JSON-RPC protocol
    const mockServerScript = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.on('line', (line) => {
        try {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: { protocolVersion: '2024-11-05', serverInfo: { name: 'mock-stdio-server', version: '1.0.0' } }
            }) + '\\n');
          } else if (req.method === 'tools/list') {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: {
                tools: [
                  {
                    name: 'inspect_item',
                    description: 'Inspect an item by id',
                    inputSchema: {
                      type: 'object',
                      properties: { itemId: { type: 'string' } },
                      required: ['itemId']
                    }
                  },
                  {
                    name: 'delete_item',
                    description: 'Delete an item by id permanently',
                    inputSchema: {
                      type: 'object',
                      properties: { itemId: { type: 'string' } },
                      required: ['itemId']
                    }
                  }
                ]
              }
            }) + '\\n');
          } else if (req.method === 'tools/call') {
            if (req.params.name === 'inspect_item') {
              process.stdout.write(JSON.stringify({
                jsonrpc: '2.0',
                id: req.id,
                result: { content: [{ type: 'text', text: 'Item data for ' + (req.params.arguments ? req.params.arguments.itemId : 'unknown') }] }
              }) + '\\n');
            } else if (req.params.name === 'delete_item') {
              process.stdout.write(JSON.stringify({
                jsonrpc: '2.0',
                id: req.id,
                result: { content: [{ type: 'text', text: 'Deleted ' + (req.params.arguments ? req.params.arguments.itemId : 'unknown') }] }
              }) + '\\n');
            }
          } else if (req.method === 'ping') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }) + '\\n');
          }
        } catch (err) {}
      });
    `;

    await manager.addServer({
      id: 'mock-node-mcp',
      name: 'Mock Node MCP',
      description: 'Testing live stdio client',
      transport: 'stdio',
      command: process.execPath,
      args: ['-e', mockServerScript],
      autoConnect: false,
    });

    // Initial state is disconnected
    let state = manager.getServerState('mock-node-mcp');
    expect(state?.status).toBe('disconnected');
    expect(state?.tools.length).toBe(0);

    // Connect
    const connectedState = await manager.connectServer('mock-node-mcp');
    expect(connectedState.status).toBe('connected');
    expect(connectedState.tools.length).toBe(2);

    const inspectTool = connectedState.tools.find(t => t.name === 'inspect_item');
    expect(inspectTool).toBeDefined();
    expect(inspectTool?.permissionLevel).toBe('read');
    expect(inspectTool?.requiresApproval).toBe(false);

    const deleteTool = connectedState.tools.find(t => t.name === 'delete_item');
    expect(deleteTool).toBeDefined();
    expect(deleteTool?.permissionLevel).toBe('destructive');
    expect(deleteTool?.requiresApproval).toBe(true);

    // Health check / ping test
    const pingResult = await manager.testServer('mock-node-mcp');
    expect(pingResult.success).toBe(true);
    expect(pingResult.toolCount).toBe(2);

    // Call read tool without approval: succeeds
    const readCall = await manager.callTool('mock-node-mcp', 'inspect_item', { itemId: 'item-42' });
    expect(readCall.status).toBe('success');
    expect((readCall.output as any).content[0].text).toContain('Item data for item-42');

    // Input schema validation failure: missing required itemId
    await expect(manager.callTool('mock-node-mcp', 'inspect_item', {}))
      .rejects.toThrow('Missing required parameter: "itemId"');

    // Input schema validation failure: wrong type
    await expect(manager.callTool('mock-node-mcp', 'inspect_item', { itemId: 12345 }))
      .rejects.toThrow('Invalid type for argument "itemId"');

    // Destructive tool call WITHOUT approval: BLOCKED
    const blockedCall = await manager.callTool('mock-node-mcp', 'delete_item', { itemId: 'item-42' }, false);
    expect(blockedCall.status).toBe('blocked');
    expect(blockedCall.error).toContain('Action blocked');

    // Destructive tool call WITH explicit approval: SUCCEEDS
    const deleteCall = await manager.callTool('mock-node-mcp', 'delete_item', { itemId: 'item-42' }, true);
    expect(deleteCall.status).toBe('success');
    expect((deleteCall.output as any).content[0].text).toContain('Deleted item-42');

    // Disconnect server
    const disconnectedState = await manager.disconnectServer('mock-node-mcp');
    expect(disconnectedState.status).toBe('disconnected');

    // Calling tool on disconnected server returns error status
    const disconnectedCall = await manager.callTool('mock-node-mcp', 'inspect_item', { itemId: '1' });
    expect(disconnectedCall.status).toBe('error');
    expect(disconnectedCall.error).toContain('not connected');

    // Remove server
    await manager.removeServer('mock-node-mcp');
    expect(manager.getServerState('mock-node-mcp')).toBeUndefined();
  });

  it('handles child process exits and communication errors safely', async () => {
    // A script that exits immediately upon start
    const dyingScript = 'process.exit(1);';

    await manager.addServer({
      id: 'dying-server',
      name: 'Dying Server',
      transport: 'stdio',
      command: process.execPath,
      args: ['-e', dyingScript],
      autoConnect: false,
    });

    await expect(manager.connectServer('dying-server')).rejects.toThrow();

    const state = manager.getServerState('dying-server');
    expect(state?.status).toBe('error');
    expect(state?.error).toBeDefined();
  });
});
