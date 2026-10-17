import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { AgentForgeMcpServer } from './mcp-server.js';

describe('AgentForgeMcpServer (Antigravity MCP Integration)', () => {
  const root = resolve(import.meta.dirname, '..');
  const bridgesDir = join(root, 'bridges');
  let tempAuthDir: string;
  let server: AgentForgeMcpServer;

  beforeAll(async () => {
    tempAuthDir = await mkdtemp(join(tmpdir(), 'agentforge-mcp-server-test-'));
    process.env.AGENTFORGE_CREDENTIALS_DIR = tempAuthDir;
    server = new AgentForgeMcpServer(bridgesDir);
  });

  afterAll(async () => {
    delete process.env.AGENTFORGE_CREDENTIALS_DIR;
    try {
      await rm(tempAuthDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('handles initialize request according to MCP protocol', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    });

    expect(res).not.toBeNull();
    expect(res?.id).toBe(1);
    expect(res?.result).toHaveProperty('protocolVersion', '2024-11-05');
    expect(res?.result).toHaveProperty('serverInfo');
    const info = (res?.result as { serverInfo: { name: string; version: string } }).serverInfo;
    expect(info.name).toBe('agentforge');
  });

  it('handles ping request', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'ping',
    });
    expect(res?.id).toBe(2);
    expect(res?.result).toEqual({});
  });

  it('exposes callable tools via tools/list', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    });

    expect(res?.result).toHaveProperty('tools');
    const tools = (res?.result as { tools: Array<{ name: string; description: string }> }).tools;
    const toolNames = tools.map(t => t.name);

    expect(toolNames).toContain('agentforge_list_bridges');
    expect(toolNames).toContain('agentforge_check_integrations');
    expect(toolNames).toContain('agentforge_run_action');
    expect(toolNames).toContain('agentforge_validate_manifest');
    expect(toolNames).toContain('agentforge_list_catalog');
    expect(toolNames).toContain('agentforge_list_mcp_servers');
    expect(toolNames).toContain('agentforge_manage_mcp_server');
    expect(toolNames).toContain('agentforge_run_mcp_tool');
  });

  it('calls agentforge_list_bridges tool', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'agentforge_list_bridges',
        arguments: {},
      },
    });

    expect(res?.result).toHaveProperty('content');
    const content = (res?.result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].text).toContain('github');
    expect(content[0].text).toContain('example-echo');
  });

  it('calls agentforge_check_integrations tool truthfully', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'agentforge_check_integrations',
        arguments: {},
      },
    });

    const content = (res?.result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.git.available).toBe(true);
    expect(parsed.githubCli.available).toBe(false);
    expect(parsed).toHaveProperty('google');
    expect(parsed.google).toHaveProperty('status');
    expect(parsed.google).toHaveProperty('clientConfigured');
    expect(parsed.google).toHaveProperty('accountConnected');
  });

  it('executes real read action via agentforge_run_action', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'agentforge_run_action',
        arguments: {
          bridge: 'github',
          action: 'status-check',
          inputs: { path: root },
        },
      },
    });

    const content = (res?.result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.status).toBe('success');
    expect(parsed.bridge).toBe('github');
    expect(parsed.action).toBe('status-check');
    expect(parsed.output).toHaveProperty('branch');
    expect(parsed.output).toHaveProperty('clean');
  });

  it('blocks publishing action in agentforge_run_action without prior approval', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'agentforge_run_action',
        arguments: {
          bridge: 'example-echo',
          action: 'publish-example',
          inputs: { target: 'public' },
        },
      },
    });

    const content = (res?.result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.status).toBe('blocked');
    expect(parsed.requiresApproval).toBe(true);
    expect(parsed.level).toBe('publish');
  });

  it('validates manifest via agentforge_validate_manifest', async () => {
    const validJson = JSON.stringify({
      schema: '1.0',
      name: 'test-custom',
      displayName: 'Custom',
      description: 'Desc',
      version: '0.1.0',
      capabilities: [
        { action: 'act', description: 'desc', permissionLevel: 'read', sideEffects: false },
      ],
      integrations: [],
      auth: [],
      permissions: [{ actions: '*', level: 'read', requiresApproval: false }],
    });

    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'agentforge_validate_manifest',
        arguments: { manifestJson: validJson },
      },
    });

    const content = (res?.result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.valid).toBe(true);
  });

  it('calls agentforge_list_catalog tool returning unified catalog summary and items', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'agentforge_list_catalog',
        arguments: {},
      },
    });

    const content = (res?.result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('items');
    expect(parsed.summary.builtinBridges).toBeGreaterThanOrEqual(2);
    expect(parsed.items.some((i: any) => i.name === 'github')).toBe(true);
  });

  it('manages external MCP servers via agentforge_manage_mcp_server and agentforge_list_mcp_servers', async () => {
    // 1. Add server
    const addRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'agentforge_manage_mcp_server',
        arguments: {
          action: 'add',
          config: {
            id: 'mcp-server-test',
            name: 'MCP Server Test',
            transport: 'stdio',
            command: 'node',
            args: ['-e', 'process.exit(0)'],
            autoConnect: false,
          },
        },
      },
    });
    const addContent = (addRes?.result as { content: Array<{ type: string; text: string }> }).content;
    const addParsed = JSON.parse(addContent[0].text);
    expect(addParsed.status).toBe('success');
    expect(addParsed.action).toBe('add');
    expect(addParsed.server.id).toBe('mcp-server-test');

    // 2. List servers
    const listRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'agentforge_list_mcp_servers',
        arguments: {},
      },
    });
    const listContent = (listRes?.result as { content: Array<{ type: string; text: string }> }).content;
    const listParsed = JSON.parse(listContent[0].text);
    expect(listParsed.count).toBeGreaterThanOrEqual(1);
    expect(listParsed.servers.some((s: any) => s.id === 'mcp-server-test')).toBe(true);

    // 3. Remove server
    const removeRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'agentforge_manage_mcp_server',
        arguments: {
          action: 'remove',
          serverId: 'mcp-server-test',
        },
      },
    });
    const removeContent = (removeRes?.result as { content: Array<{ type: string; text: string }> }).content;
    const removeParsed = JSON.parse(removeContent[0].text);
    expect(removeParsed.status).toBe('success');
    expect(removeParsed.action).toBe('remove');
  });

  it('fails safely when calling agentforge_run_mcp_tool on unknown or disconnected server', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'agentforge_run_mcp_tool',
        arguments: {
          serverId: 'non-existent-server',
          toolName: 'test-tool',
          toolArguments: {},
        },
      },
    });

    const isError = (res?.result as { isError?: boolean }).isError;
    expect(isError).toBe(true);
    const content = (res?.result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].text).toContain('not found or server is not connected');
  });
});
