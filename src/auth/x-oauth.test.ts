import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XOAuthService, X_AUTH_URL } from './x-oauth.js';
import { MemoryCredentialStore } from './credential-store.js';

describe('XOAuthService', () => {
  let tempDir: string;
  let memStore: MemoryCredentialStore;
  let service: XOAuthService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentforge-x-auth-test-'));
    process.env.AGENTFORGE_CREDENTIALS_DIR = tempDir;
    delete process.env.X_CLIENT_ID;
    delete process.env.X_CLIENT_SECRET;
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_USER_ID;
    delete process.env.TWITTER_CLIENT_ID;
    delete process.env.TWITTER_CLIENT_SECRET;
    delete process.env.TWITTER_ACCESS_TOKEN;

    memStore = new MemoryCredentialStore();
    service = new XOAuthService(memStore);
  });

  afterEach(async () => {
    delete process.env.X_CLIENT_ID;
    delete process.env.X_CLIENT_SECRET;
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_USER_ID;
    delete process.env.TWITTER_CLIENT_ID;
    delete process.env.TWITTER_CLIENT_SECRET;
    delete process.env.TWITTER_ACCESS_TOKEN;
    delete process.env.AGENTFORGE_CREDENTIALS_DIR;
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Configuration Resolution', () => {
    it('returns null when no client ID is set', async () => {
      const config = await service.getClientConfig();
      expect(config).toBeNull();
    });

    it('resolves config from environment variables', async () => {
      process.env.X_CLIENT_ID = 'test-x-client-id';
      process.env.X_CLIENT_SECRET = 'test-x-client-secret';

      const config = await service.getClientConfig();
      expect(config).not.toBeNull();
      expect(config?.clientId).toBe('test-x-client-id');
      expect(config?.clientSecret).toBe('test-x-client-secret');
      expect(config?.source).toBe('env');
    });

    it('saves and reads developer config file', async () => {
      const savedPath = await service.saveDeveloperConfig('dev-x-123', 'dev-x-secret', 'http://localhost:43111/custom');
      expect(savedPath).toContain('x-developer-config.json');

      const config = await service.getClientConfig();
      expect(config?.clientId).toBe('dev-x-123');
      expect(config?.clientSecret).toBe('dev-x-secret');
      expect(config?.redirectUri).toBe('http://localhost:43111/custom');
      expect(config?.source).toBe('config-file');

      const deleted = await service.deleteDeveloperConfig();
      expect(deleted).toBe(true);

      const afterDelete = await service.getClientConfig();
      expect(afterDelete).toBeNull();
    });
  });

  describe('Authorization URL Generation with PKCE', () => {
    it('builds standard X authorization URL with code_challenge and state', () => {
      const url = service.createAuthorizationUrl(
        { clientId: 'my-x-client', source: 'direct' },
        'http://localhost:43111/callback',
        'test-state-abc',
        'test-challenge-123',
      );

      expect(url).toContain(X_AUTH_URL);
      expect(url).toContain('client_id=my-x-client');
      expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A43111%2Fcallback');
      expect(url).toContain('response_type=code');
      expect(url).toContain('code_challenge=test-challenge-123');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('scope=tweet.read');
    });
  });

  describe('Connection Status & Vault', () => {
    it('reports unconfigured status when no client ID is found', async () => {
      const status = await service.getStatus();
      expect(status.status).toBe('unconfigured');
      expect(status.connected).toBe(false);
    });

    it('reports connected when X_ACCESS_TOKEN is set in environment', async () => {
      process.env.X_ACCESS_TOKEN = 'env-token-xyz';
      process.env.X_USER_ID = 'user123';

      const status = await service.getStatus();
      expect(status.status).toBe('connected');
      expect(status.connected).toBe(true);
      expect(status.connectedAccount).toBe('@user123');
    });

    it('reports connected when valid credentials stored in vault', async () => {
      await memStore.save('x', {
        provider: 'x',
        accessToken: 'vault-x-token-999',
        userId: '88888',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        extraData: { username: 'antigravity_dev', name: 'Antigravity' },
        updatedAt: new Date().toISOString(),
      });

      const status = await service.getStatus();
      expect(status.status).toBe('connected');
      expect(status.connected).toBe(true);
      expect(status.connectedAccount).toBe('@antigravity_dev');
    });

    it('logs out and clears environment and storage', async () => {
      process.env.X_ACCESS_TOKEN = 'token-to-delete';
      await memStore.save('x', {
        provider: 'x',
        accessToken: 'token-to-delete',
        updatedAt: new Date().toISOString(),
      });

      const loggedOut = await service.logout();
      expect(loggedOut).toBe(true);
      expect(process.env.X_ACCESS_TOKEN).toBeUndefined();

      const after = await service.getStatus();
      expect(after.connected).toBe(false);
    });
  });
});
