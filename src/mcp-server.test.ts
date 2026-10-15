import { describe, it, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { AgentForgeMcpServer } from './mcp-server.js';

describe('AgentForgeMcpServer (Antigravity MCP Integration)', () => {
  const root = resolve(import.meta.dirname, '..');
  const bridgesDir = join(root, 'bridges');
  const server = new AgentForgeMcpServer(bridgesDir);

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
});
