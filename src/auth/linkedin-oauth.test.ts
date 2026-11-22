import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LinkedInOAuthService } from './linkedin-oauth.js';
import { MemoryCredentialStore } from './credential-store.js';

describe('LinkedInOAuthService', () => {
  let tempDir: string;
  let memStore: MemoryCredentialStore;
  let service: LinkedInOAuthService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentforge-linkedin-test-'));
    process.env.AGENTFORGE_CREDENTIALS_DIR = tempDir;
    delete process.env.LINKEDIN_CLIENT_ID;
    delete process.env.LINKEDIN_CLIENT_SECRET;
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_PERSON_URN;

    memStore = new MemoryCredentialStore();
    service = new LinkedInOAuthService(memStore);
  });

  afterEach(async () => {
    delete process.env.LINKEDIN_CLIENT_ID;
    delete process.env.LINKEDIN_CLIENT_SECRET;
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_PERSON_URN;
    delete process.env.AGENTFORGE_CREDENTIALS_DIR;
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Configuration & Credentials Resolution', () => {
    it('returns null when no environment variables or file exist', async () => {
      const config = await service.getClientConfig();
      expect(config).toBeNull();
    });

    it('resolves config from environment variables', async () => {
      process.env.LINKEDIN_CLIENT_ID = 'test-client-id-env';
      process.env.LINKEDIN_CLIENT_SECRET = 'test-client-secret-env';

      const config = await service.getClientConfig();
      expect(config).not.toBeNull();
      expect(config?.clientId).toBe('test-client-id-env');
      expect(config?.clientSecret).toBe('test-client-secret-env');
      expect(config?.source).toBe('env');
    });

    it('saves and reads developer config file', async () => {
      const savedPath = await service.saveDeveloperConfig('dev-client-123', 'dev-secret-456', 'http://localhost:43110/custom');
      expect(savedPath).toContain('linkedin-client.json');

      const config = await service.getClientConfig();
      expect(config?.clientId).toBe('dev-client-123');
      expect(config?.clientSecret).toBe('dev-secret-456');
      expect(config?.redirectUri).toBe('http://localhost:43110/custom');
      expect(config?.source).toBe('config-file');

      const deleted = await service.deleteDeveloperConfig();
      expect(deleted).toBe(true);

      const afterDelete = await service.getClientConfig();
      expect(afterDelete).toBeNull();
    });
  });

  describe('Authorization URL Generation', () => {
    it('builds standard LinkedIn authorization URL with scopes and state', async () => {
      process.env.LINKEDIN_CLIENT_ID = 'my-app-id';

      const authUrl = await service.createAuthorizationUrl({
        redirectUri: 'http://localhost:43110/callback',
        state: 'secure-random-state',
      });

      expect(authUrl).toContain('https://www.linkedin.com/oauth/v2/authorization');
      expect(authUrl).toContain('response_type=code');
      expect(authUrl).toContain('client_id=my-app-id');
      expect(authUrl).toContain('redirect_uri=' + encodeURIComponent('http://localhost:43110/callback'));
      expect(authUrl).toContain('state=secure-random-state');
      expect(authUrl).toContain('openid');
      expect(authUrl).toContain('w_member_social');
    });
  });

  describe('Status Reporting & Logout', () => {
    it('reports unconfigured status when no app credentials exist', async () => {
      const status = await service.getStatus();
      expect(status.status).toBe('unconfigured');
      expect(status.clientConfigured).toBe(false);
      expect(status.connected).toBe(false);
    });

    it('reports configured status when developer credentials exist but no token stored', async () => {
      process.env.LINKEDIN_CLIENT_ID = 'my-client-id';
      const status = await service.getStatus();
      expect(status.status).toBe('configured');
      expect(status.clientConfigured).toBe(true);
      expect(status.connected).toBe(false);
    });

    it('reports connected status when credentials are saved in credential store', async () => {
      await memStore.save('linkedin', {
        provider: 'linkedin',
        refreshToken: '',
        accessToken: 'mock-linkedin-access-token',
        expiresAt: Date.now() + 3600000,
        scopes: ['openid', 'profile', 'w_member_social'],
        userId: 'abc123person',
        userEmail: 'user@linkedin.test',
        extraData: {
          personUrn: 'urn:li:person:abc123person',
          name: 'Jane Doe',
        },
        updatedAt: new Date().toISOString(),
      });

      const status = await service.getStatus();
      expect(status.status).toBe('connected');
      expect(status.connected).toBe(true);
      expect(status.accountName).toBe('Jane Doe');
      expect(status.personUrn).toBe('urn:li:person:abc123person');
      expect(status.accountEmail).toBe('user@linkedin.test');
      expect(status.scopes).toContain('w_member_social');
    });

    it('clears stored credentials and resets process.env on logout', async () => {
      await memStore.save('linkedin', {
        provider: 'linkedin',
        refreshToken: '',
        accessToken: 'token-to-delete',
        expiresAt: Date.now() + 3600000,
        scopes: ['openid'],
        updatedAt: new Date().toISOString(),
      });
      process.env.LINKEDIN_ACCESS_TOKEN = 'token-to-delete';
      process.env.LINKEDIN_PERSON_URN = 'urn:li:person:xyz';

      const deleted = await service.logout();
      expect(deleted).toBe(true);
      expect(await memStore.load('linkedin')).toBeNull();
      expect(process.env.LINKEDIN_ACCESS_TOKEN).toBeUndefined();
      expect(process.env.LINKEDIN_PERSON_URN).toBeUndefined();
    });
  });
});
