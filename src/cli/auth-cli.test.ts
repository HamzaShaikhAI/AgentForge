import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './index.js';

describe('AgentForge Auth CLI', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let cliTempDir: string;

  beforeEach(async () => {
    cliTempDir = await mkdtemp(join(tmpdir(), 'agentforge-cli-test-'));
    process.env.AGENTFORGE_CREDENTIALS_DIR = cliTempDir;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_CONFIG;
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_SECRET;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_CONFIG;
    delete process.env.AGENTFORGE_CREDENTIALS_DIR;
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_SECRET;
    try {
      await rm(cliTempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('prints general help for --help', async () => {
    const exitCode = await runCli(['--help']);
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('AgentForge');
    expect(output).toContain('USAGE:');
  });

  it('prints auth help for "auth help"', async () => {
    const exitCode = await runCli(['auth', 'help']);
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('AgentForge Authentication CLI');
    expect(output).toContain('ONE-TIME GOOGLE CLOUD SETUP GUIDE:');
    expect(output).toContain('agentforge auth google');
  });

  it('prints status for "auth status"', async () => {
    const exitCode = await runCli(['auth', 'status']);
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('AgentForge Authentication Status');
    expect(output).toContain('Provider:');
    expect(output).toContain('Google OAuth 2.0');
    expect(output).toContain('Auth Mode:          UNCONFIGURED');
    expect(output).toContain('Publisher Setup Requirements');
  });

  it('prints zero-config status when AGENTFORGE_BUILTIN_CLIENT_ID is set', async () => {
    process.env.AGENTFORGE_BUILTIN_CLIENT_ID = 'test-builtin.apps.googleusercontent.com';
    const exitCode = await runCli(['auth', 'status']);
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Auth Mode:          ZERO-CONFIG');
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
  });

  it('handles "auth configure" command and validates arguments', async () => {
    // Missing --client-id
    const badCode = await runCli(['auth', 'configure']);
    expect(badCode).toBe(1);
    expect(errorSpy.mock.calls.map(c => c.join(' ')).join('\n')).toContain('Missing required argument: --client-id');

    // Valid --client-id
    const goodCode = await runCli(['auth', 'configure', '--client-id', 'test-cfg.apps.googleusercontent.com']);
    expect(goodCode).toBe(0);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Developer OAuth client credentials saved successfully');
  });

  it('exits with error and explains setup when running "auth google" without credentials', async () => {
    const exitCode = await runCli(['auth', 'google']);
    expect(exitCode).toBe(1);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Google OAuth client credentials not found');
    expect(output).toContain('$env:GOOGLE_CLIENT_ID');
  });

  it('handles "auth logout google"', async () => {
    const exitCode = await runCli(['auth', 'logout', 'google']);
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('disconnected successfully');
  });

  it('rejects unknown commands', async () => {
    const exitCode = await runCli(['unknown-command']);
    expect(exitCode).toBe(1);
  });
});
