import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, Server } from 'node:http';
import { GoogleOAuthService, DEFAULT_MINIMAL_SCOPES, validateGoogleClientId } from './google-oauth.js';
import { MemoryCredentialStore } from './credential-store.js';

describe('GoogleOAuthService (Core Integration)', () => {
  let tempDir: string;
  let memStore: MemoryCredentialStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentforge-test-oauth-'));
    process.env.AGENTFORGE_CREDENTIALS_DIR = tempDir;
    memStore = new MemoryCredentialStore();
    // Clear relevant env vars before each test
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_CONFIG;
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_SECRET;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_CONFIG;
    delete process.env.AGENTFORGE_CREDENTIALS_DIR;
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_SECRET;
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Configuration Discovery', () => {
    it('resolves credentials from environment variables', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

      const service = new GoogleOAuthService({ credentialStore: memStore });
      const config = await service.getClientConfig();

      expect(config).not.toBeNull();
      expect(config?.clientId).toBe('test-client-id.apps.googleusercontent.com');
      expect(config?.clientSecret).toBe('test-client-secret');
      expect(config?.source).toBe('env');
    });

    it('resolves credentials from downloaded Google Cloud console JSON file', async () => {
      const configFilePath = join(tempDir, 'google-client.json');
      await writeFile(
        configFilePath,
        JSON.stringify({
          installed: {
            client_id: 'downloaded-client-id.apps.googleusercontent.com',
            client_secret: 'downloaded-secret',
          },
        }),
      );
      process.env.GOOGLE_CLIENT_CONFIG = configFilePath;

      const service = new GoogleOAuthService({ credentialStore: memStore });
      const config = await service.getClientConfig();

      expect(config).not.toBeNull();
      expect(config?.clientId).toBe('downloaded-client-id.apps.googleusercontent.com');
      expect(config?.clientSecret).toBe('downloaded-secret');
      expect(config?.source).toBe('config-file');
      expect(config?.configPath).toBe(configFilePath);
    });

    it('returns null when no client configuration exists', async () => {
      const service = new GoogleOAuthService({ credentialStore: memStore });
      const config = await service.getClientConfig();
      expect(config).toBeNull();
    });
  });

  describe('PKCE & Authorization URL', () => {
    it('generates SHA256 PKCE challenge and verifier', () => {
      const service = new GoogleOAuthService({ credentialStore: memStore });
      const pkce = service.generatePKCE();

      expect(pkce.verifier).toHaveLength(43);
      expect(pkce.challenge).toHaveLength(43);
      expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('constructs authorization URL with minimal scopes and offline access', () => {
      const service = new GoogleOAuthService({ credentialStore: memStore });
      const url = service.createAuthorizationUrl(
        { clientId: 'mock-id', clientSecret: 'mock-sec', source: 'env' },
        'http://127.0.0.1:8910/callback',
        'mock-state',
        'mock-challenge',
      );

      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://accounts.google.com');
      expect(parsed.searchParams.get('client_id')).toBe('mock-id');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8910/callback');
      expect(parsed.searchParams.get('access_type')).toBe('offline');
      expect(parsed.searchParams.get('prompt')).toBe('consent');
      expect(parsed.searchParams.get('state')).toBe('mock-state');
      expect(parsed.searchParams.get('code_challenge')).toBe('mock-challenge');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');

      // Minimal scopes verification (never requests broad access initially)
      const requestedScopes = parsed.searchParams.get('scope')?.split(' ');
      expect(requestedScopes).toEqual(DEFAULT_MINIMAL_SCOPES);
    });
  });

  describe('OAuth Interactive Callback & Error Handling', () => {
    it('handles user denying consent during authorization', async () => {
      process.env.GOOGLE_CLIENT_ID = '123456789012-testclient.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

      const service = new GoogleOAuthService({
        credentialStore: memStore,
        customPort: 8931,
      });

      // Mock openBrowser so browser is not launched during test
      vi.spyOn(service, 'openBrowser').mockResolvedValue(true);

      const authPromise = service.authenticateInteractive({ timeoutMs: 5000 });
      const rejectAssertion = expect(authPromise).rejects.toThrow(
        'User denied consent during Google OAuth authorization.',
      );

      // Simulate browser receiving access_denied from Google
      await new Promise(r => setTimeout(r, 100));
      const resp = await fetch('http://127.0.0.1:8931/callback?error=access_denied');
      expect(resp.status).toBe(400);

      await rejectAssertion;
    });

    it('rejects callback with invalid CSRF state', async () => {
      process.env.GOOGLE_CLIENT_ID = '123456789012-testclient.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

      const service = new GoogleOAuthService({
        credentialStore: memStore,
        customPort: 8932,
      });

      vi.spyOn(service, 'openBrowser').mockResolvedValue(true);

      const authPromise = service.authenticateInteractive({ timeoutMs: 5000 });
      const rejectAssertion = expect(authPromise).rejects.toThrow('Invalid OAuth state parameter.');

      await new Promise(r => setTimeout(r, 100));
      const resp = await fetch('http://127.0.0.1:8932/callback?code=mock-code&state=wrong-state');
      expect(resp.status).toBe(400);

      await rejectAssertion;
    });

    it('completes code exchange and stores credentials with user info', async () => {
      process.env.GOOGLE_CLIENT_ID = '123456789012-testclient.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

      const service = new GoogleOAuthService({
        credentialStore: memStore,
        customPort: 8933,
      });

      vi.spyOn(service, 'openBrowser').mockResolvedValue(true);

      // Mock exchangeCode and fetchUserInfo
      vi.spyOn(service, 'exchangeCode').mockResolvedValue({
        accessToken: 'mock-access-token-123',
        refreshToken: 'mock-refresh-token-456',
        expiresIn: 3600,
        expiresAt: Date.now() + 3600000,
        scopes: DEFAULT_MINIMAL_SCOPES,
        tokenType: 'Bearer',
      });

      vi.spyOn(service, 'fetchUserInfo').mockResolvedValue({
        email: 'developer@example.com',
        sub: 'google-user-sub-100',
      });

      let capturedState = '';
      const authPromise = service.authenticateInteractive({
        timeoutMs: 5000,
        onPromptUrl: url => {
          const parsed = new URL(url);
          capturedState = parsed.searchParams.get('state') || '';
        },
      });

      await new Promise(r => setTimeout(r, 100));
      const resp = await fetch(
        `http://127.0.0.1:8933/callback?code=valid-test-code&state=${capturedState}`,
      );
      expect(resp.status).toBe(200);

      const stored = await authPromise;
      expect(stored.provider).toBe('google');
      expect(stored.refreshToken).toBe('mock-refresh-token-456');
      expect(stored.accessToken).toBe('mock-access-token-123');
      expect(stored.userEmail).toBe('developer@example.com');

      // Verify stored in credential store
      const inStore = await memStore.load('google');
      expect(inStore?.refreshToken).toBe('mock-refresh-token-456');
    });
  });

  describe('Token Refresh and Revocation', () => {
    it('automatically refreshes expired access token when requested', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

      // Pre-seed store with an expired access token
      await memStore.save('google', {
        provider: 'google',
        refreshToken: 'valid-refresh-token',
        accessToken: 'expired-access-token',
        expiresAt: Date.now() - 1000, // already expired
        scopes: DEFAULT_MINIMAL_SCOPES,
        userEmail: 'dev@example.com',
        updatedAt: new Date().toISOString(),
      });

      const service = new GoogleOAuthService({ credentialStore: memStore });

      // Mock refreshAccessToken
      vi.spyOn(service, 'refreshAccessToken').mockResolvedValue({
        accessToken: 'new-refreshed-access-token',
        expiresIn: 3600,
        expiresAt: Date.now() + 3600000,
        scopes: DEFAULT_MINIMAL_SCOPES,
        tokenType: 'Bearer',
      });

      const token = await service.getValidAccessToken();
      expect(token).toBe('new-refreshed-access-token');

      // Check store was updated
      const updated = await memStore.load('google');
      expect(updated?.accessToken).toBe('new-refreshed-access-token');
    });

    it('handles revoked credentials (invalid_grant) and marks connection as revoked', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

      await memStore.save('google', {
        provider: 'google',
        refreshToken: 'revoked-refresh-token',
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1000,
        scopes: DEFAULT_MINIMAL_SCOPES,
        userEmail: 'dev@example.com',
        updatedAt: new Date().toISOString(),
      });

      const service = new GoogleOAuthService({ credentialStore: memStore });

      vi.spyOn(service, 'refreshAccessToken').mockRejectedValue(
        new Error('Google refresh token has expired or been revoked by the user.'),
      );

      await expect(service.getValidAccessToken()).rejects.toThrow(
        'Google refresh token has expired or been revoked',
      );

      const status = await service.getStatus();
      expect(status.status).toBe('revoked');
      expect(status.accountConnected).toBe(false);
    });

    it('logs out by revoking remote token and deleting local storage', async () => {
      await memStore.save('google', {
        provider: 'google',
        refreshToken: 'token-to-revoke',
        scopes: DEFAULT_MINIMAL_SCOPES,
        updatedAt: new Date().toISOString(),
      });

      // Mock fetch for Google revoke endpoint
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

      const service = new GoogleOAuthService({ credentialStore: memStore });
      const result = await service.logout();

      expect(result.revokedRemote).toBe(true);
      expect(result.deletedLocal).toBe(true);
      expect(await memStore.load('google')).toBeNull();
    });
  });

  describe('Scope Validation and Connection Status Reporting', () => {
    it('verifies granted scopes accurately', async () => {
      await memStore.save('google', {
        provider: 'google',
        refreshToken: 'token',
        scopes: ['openid', 'email', 'profile'],
        updatedAt: new Date().toISOString(),
      });

      const service = new GoogleOAuthService({ credentialStore: memStore });

      expect(await service.hasScopes(['openid', 'email'])).toBe(true);
      expect(await service.hasScopes(['openid', 'https://www.googleapis.com/auth/youtube'])).toBe(false);
    });

    it('accurately distinguishes unconfigured, configured, and connected states', async () => {
      const service = new GoogleOAuthService({ credentialStore: memStore });

      // 1. Unconfigured
      let status = await service.getStatus();
      expect(status.status).toBe('unconfigured');
      expect(status.clientConfigured).toBe(false);
      expect(status.accountConnected).toBe(false);

      // 2. Configured (Client ID exists, but no account connected yet)
      process.env.GOOGLE_CLIENT_ID = 'test-client';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

      status = await service.getStatus();
      expect(status.status).toBe('configured');
      expect(status.clientConfigured).toBe(true);
      expect(status.accountConnected).toBe(false);

      // 3. Connected
      await memStore.save('google', {
        provider: 'google',
        refreshToken: 'active-refresh-token',
        accessToken: 'active-access-token',
        expiresAt: Date.now() + 3600000,
        scopes: DEFAULT_MINIMAL_SCOPES,
        userEmail: 'dev-user@example.com',
        updatedAt: new Date().toISOString(),
      });

      status = await service.getStatus();
      expect(status.status).toBe('connected');
      expect(status.accountConnected).toBe(true);
      expect(status.connectedAccount).toBe('d******r@example.com');
      // Invariant: Available is false for overall Google service until specific bridges are ready
      expect(status.available).toBe(false);

      // Invariant: Status never contains raw token strings
      const jsonStatus = JSON.stringify(status);
      expect(jsonStatus).not.toContain('active-refresh-token');
      expect(jsonStatus).not.toContain('active-access-token');
    });
  });

  describe('Production Readiness & Security Hardening (Milestone 3.1 Audits)', () => {
    it('discovers downloaded Google Cloud Console JSON with client_secret_*.json naming', async () => {
      const standardGoogleFileName = 'client_secret_12345-abcdefg.apps.googleusercontent.com.json';
      const downloadedPath = join(tempDir, standardGoogleFileName);

      await writeFile(
        downloadedPath,
        JSON.stringify({
          installed: {
            client_id: 'standard-console-id.apps.googleusercontent.com',
            project_id: 'sample-project',
            auth_uri: 'https://accounts.google.com/o/oauth2/auth',
            token_uri: 'https://oauth2.googleapis.com/token',
            client_secret: 'GOCSPX-SampleSecretKey',
            redirect_uris: ['http://localhost'],
          },
        }),
      );

      // Point GOOGLE_CLIENT_CONFIG directly or test candidate lookup
      process.env.GOOGLE_CLIENT_CONFIG = downloadedPath;
      const service = new GoogleOAuthService({ credentialStore: memStore });
      const config = await service.getClientConfig();

      expect(config).not.toBeNull();
      expect(config?.clientId).toBe('standard-console-id.apps.googleusercontent.com');
      expect(config?.clientSecret).toBe('GOCSPX-SampleSecretKey');
      expect(config?.source).toBe('config-file');
    });

    it('handles callback port conflict (EADDRINUSE) gracefully without crashing', async () => {
      process.env.GOOGLE_CLIENT_ID = '123456789012-testclient.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

      const occupiedPort = 8945;
      const blockerServer = createServer((_req, res) => {
        res.end('occupied');
      });

      await new Promise<void>(resolve => {
        blockerServer.listen(occupiedPort, '127.0.0.1', () => resolve());
      });

      try {
        const service = new GoogleOAuthService({
          credentialStore: memStore,
          customPort: occupiedPort,
        });

        await expect(service.authenticateInteractive({ timeoutMs: 2000 })).rejects.toThrow(
          `OAuth callback port ${occupiedPort} is already in use by another application.`,
        );
      } finally {
        await new Promise<void>(resolve => {
          blockerServer.close(() => resolve());
        });
      }
    });

    it('rejects callback with untrusted Host header', async () => {
      process.env.GOOGLE_CLIENT_ID = '123456789012-testclient.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

      const service = new GoogleOAuthService({
        credentialStore: memStore,
        customPort: 8946,
      });

      vi.spyOn(service, 'openBrowser').mockResolvedValue(true);
      const authPromise = service.authenticateInteractive({ timeoutMs: 3000 });
      const rejectAssertion = expect(authPromise).rejects.toThrow('Rejected callback with untrusted Host: evil.com');

      await new Promise(r => setTimeout(r, 100));

      const { get: httpGet } = await import('node:http');
      const reqStatus = await new Promise<number>(resolve => {
        const req = httpGet(
          {
            hostname: '127.0.0.1',
            port: 8946,
            path: '/callback?code=mock-code&state=fake-state',
            headers: { Host: 'evil.com' },
          },
          res => {
            resolve(res.statusCode || 0);
          },
        );
        req.on('error', () => resolve(0));
      });

      expect(reqStatus).toBe(403);
      await rejectAssertion;
    });

    it('rejects cross-origin callback with untrusted Origin header', async () => {
      process.env.GOOGLE_CLIENT_ID = '123456789012-testclient.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

      const service = new GoogleOAuthService({
        credentialStore: memStore,
        customPort: 8947,
      });

      vi.spyOn(service, 'openBrowser').mockResolvedValue(true);
      const authPromise = service.authenticateInteractive({ timeoutMs: 3000 });
      const rejectAssertion = expect(authPromise).rejects.toThrow('Rejected cross-origin callback from origin: https://malicious-site.com');

      await new Promise(r => setTimeout(r, 100));
      const resp = await fetch('http://127.0.0.1:8947/callback?code=mock-code&state=fake-state', {
        headers: {
          Origin: 'https://malicious-site.com',
        },
      });

      expect(resp.status).toBe(403);
      await rejectAssertion;
    });

    it('enforces single-flight callback and rejects repeated requests (replay protection)', async () => {
      process.env.GOOGLE_CLIENT_ID = '123456789012-testclient.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

      const service = new GoogleOAuthService({
        credentialStore: memStore,
        customPort: 8948,
      });

      vi.spyOn(service, 'openBrowser').mockResolvedValue(true);
      vi.spyOn(service, 'exchangeCode').mockResolvedValue({
        accessToken: 'mock-access',
        refreshToken: 'mock-refresh',
        expiresIn: 3600,
        expiresAt: Date.now() + 3600000,
        scopes: DEFAULT_MINIMAL_SCOPES,
        tokenType: 'Bearer',
      });
      vi.spyOn(service, 'fetchUserInfo').mockResolvedValue({ email: 'test@example.com' });

      let capturedState = '';
      const authPromise = service.authenticateInteractive({
        timeoutMs: 3000,
        onPromptUrl: url => {
          capturedState = new URL(url).searchParams.get('state') || '';
        },
      });

      await new Promise(r => setTimeout(r, 100));

      // First callback (succeeds)
      const resp1 = await fetch(`http://127.0.0.1:8948/callback?code=mock-code&state=${capturedState}`);
      expect(resp1.status).toBe(200);

      await authPromise;

      // Duplicate callback attempt (server already closed or returns 409)
      try {
        const resp2 = await fetch(`http://127.0.0.1:8948/callback?code=mock-code&state=${capturedState}`);
        expect([409, 500]).toContain(resp2.status);
      } catch (err: unknown) {
        const error = err as Error & { code?: string; cause?: { code?: string } };
        const code = error.code || error.cause?.code;
        expect(code).toBe('ECONNREFUSED');
      }
    });

    it('sanitizes secrets and tokens from token exchange and refresh error messages', async () => {
      const config = {
        clientId: 'client-id-123',
        clientSecret: 'GOCSPX-mock-dummy-secret-key-999',
        source: 'env' as const,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'invalid_client',
            error_description: 'Bad request with secret GOCSPX-mock-dummy-secret-key-999 and token ya29.mock-leak-token-xyz',
          }),
          { status: 400 },
        ),
      );

      const service = new GoogleOAuthService({ credentialStore: memStore });

      try {
        await service.exchangeCode(config, 'code-123', 'http://127.0.0.1:8910/callback', 'verifier-123');
        expect.unreachable();
      } catch (err: unknown) {
        const msg = (err as Error).message;
        expect(msg).not.toContain('GOCSPX-mock-dummy-secret-key-999');
        expect(msg).not.toContain('ya29.mock-leak-token-xyz');
        expect(msg).toContain('[REDACTED]');
        expect(msg).toContain('[REDACTED_ACCESS_TOKEN]');
      }
    });
  });

  describe('Milestone 3.2 — Zero-Configuration & Developer Mode Tests', () => {
    it('reports authMode: "unconfigured" and publisher requirements when no client exists', async () => {
      const service = new GoogleOAuthService({ credentialStore: memStore });
      const status = await service.getStatus();

      expect(status.status).toBe('unconfigured');
      expect(status.authMode).toBe('unconfigured');
      expect(status.clientConfigured).toBe(false);
      expect(status.accountConnected).toBe(false);
      expect(status.publisherRequirement?.needed).toBe(true);
      expect(status.publisherRequirement?.status).toBe('pending-registration');
      expect(status.publisherRequirement?.steps.length).toBeGreaterThanOrEqual(4);
    });

    it('activates Zero-Configuration mode when AGENTFORGE_BUILTIN_CLIENT_ID is provided', async () => {
      process.env.AGENTFORGE_BUILTIN_CLIENT_ID = 'agentforge-official-desktop.apps.googleusercontent.com';

      const service = new GoogleOAuthService({ credentialStore: memStore });
      const status = await service.getStatus();

      expect(status.authMode).toBe('zero-config');
      expect(status.clientConfigured).toBe(true);
      expect(status.configSource).toBe('builtin');
      expect(status.note).toContain('zero-configuration Google login');

      delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
    });

    it('activates Developer Mode when user configures GOOGLE_CLIENT_ID', async () => {
      process.env.GOOGLE_CLIENT_ID = 'developer-custom-client.apps.googleusercontent.com';

      const service = new GoogleOAuthService({ credentialStore: memStore });
      const status = await service.getStatus();

      expect(status.authMode).toBe('developer-config');
      expect(status.clientConfigured).toBe(true);
      expect(status.configSource).toBe('env');

      delete process.env.GOOGLE_CLIENT_ID;
    });

    it('saveDeveloperConfig persists desktop client configuration and enables developer-config', async () => {
      const service = new GoogleOAuthService({ credentialStore: memStore });
      const filePath = await service.saveDeveloperConfig(
        'saved-client-id.apps.googleusercontent.com',
        'optional-secret-xyz',
      );

      expect(existsSync(filePath)).toBe(true);
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.installed.client_id).toBe('saved-client-id.apps.googleusercontent.com');
      expect(parsed.installed.client_secret).toBe('optional-secret-xyz');

      // Rejects empty client ID
      await expect(service.saveDeveloperConfig('   ')).rejects.toThrow('Client ID cannot be empty');
    });

    it('supports public Desktop client without client secret in token exchange and refresh', async () => {
      const publicConfig = {
        clientId: 'public-desktop-client-id.apps.googleusercontent.com',
        source: 'builtin' as const,
        isRegisteredPublisherClient: true,
      };

      let capturedExchangeBody = '';
      let capturedRefreshBody = '';

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const bodyStr = init?.body ? String(init.body) : '';
        if (bodyStr.includes('grant_type=authorization_code')) {
          capturedExchangeBody = bodyStr;
          return new Response(
            JSON.stringify({
              access_token: 'public-access-token',
              refresh_token: 'public-refresh-token',
              expires_in: 3600,
              scope: 'openid email',
              token_type: 'Bearer',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (bodyStr.includes('grant_type=refresh_token')) {
          capturedRefreshBody = bodyStr;
          return new Response(
            JSON.stringify({
              access_token: 'refreshed-public-access-token',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('Not found', { status: 404 });
      });

      const service = new GoogleOAuthService({ credentialStore: memStore });

      // Code exchange
      const tokens = await service.exchangeCode(
        publicConfig,
        'mock-code',
        'http://127.0.0.1:8910/callback',
        'mock-verifier',
      );
      expect(tokens.accessToken).toBe('public-access-token');
      expect(capturedExchangeBody).toContain('client_id=public-desktop-client-id.apps.googleusercontent.com');
      expect(capturedExchangeBody).not.toContain('client_secret');

      // Token refresh
      const refreshed = await service.refreshAccessToken('public-refresh-token', publicConfig);
      expect(refreshed.accessToken).toBe('refreshed-public-access-token');
      expect(capturedRefreshBody).toContain('client_id=public-desktop-client-id.apps.googleusercontent.com');
      expect(capturedRefreshBody).not.toContain('client_secret');
    });

    it('prevents concurrent interactive authentication sessions', async () => {
      process.env.AGENTFORGE_BUILTIN_CLIENT_ID = '123456789012-testclient.apps.googleusercontent.com';

      const service = new GoogleOAuthService({
        credentialStore: memStore,
        customPort: 8949,
      });

      vi.spyOn(service, 'openBrowser').mockResolvedValue(true);

      const auth1 = service.authenticateInteractive({ timeoutMs: 2000 });

      // Second concurrent attempt must throw
      await expect(service.authenticateInteractive({ timeoutMs: 2000 })).rejects.toThrow(
        'Authentication is already in progress',
      );

      // Clean up auth1
      await expect(auth1).rejects.toThrow('Authentication timed out');
      delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
    });

    it('detects returning user and preserves stored credentials', async () => {
      process.env.AGENTFORGE_BUILTIN_CLIENT_ID = 'test-client';

      await memStore.save('google', {
        provider: 'google',
        refreshToken: 'stored-refresh-token',
        accessToken: 'stored-access-token',
        expiresAt: Date.now() + 3600000,
        scopes: DEFAULT_MINIMAL_SCOPES,
        userEmail: 'returning.user@example.com',
        updatedAt: new Date().toISOString(),
      });

      const service = new GoogleOAuthService({ credentialStore: memStore });
      const status = await service.getStatus();

      expect(status.status).toBe('connected');
      expect(status.accountConnected).toBe(true);
      expect(status.connectedAccount).toBe('r************r@example.com');

      delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
    });
  });

  describe('Client ID Validation & Diagnostics (Regression Tests)', () => {
    describe('validateGoogleClientId', () => {
      it('reports missing for undefined or empty string', () => {
        expect(validateGoogleClientId()).toEqual({
          valid: false,
          status: 'missing',
          reason: expect.stringContaining('missing or empty'),
        });
        expect(validateGoogleClientId('   ')).toEqual({
          valid: false,
          status: 'missing',
          reason: expect.stringContaining('missing or empty'),
        });
      });

      it('detects known placeholder client IDs', () => {
        const placeholders = [
          'custom-manager-client.apps.googleusercontent.com',
          'YOUR_CLIENT_ID.apps.googleusercontent.com',
          'your-client-id.apps.googleusercontent.com',
          'placeholder.apps.googleusercontent.com',
          'custom-sample-client.apps.googleusercontent.com',
          'example.apps.googleusercontent.com',
          'xxxx.apps.googleusercontent.com',
          '<client-id>.apps.googleusercontent.com',
        ];

        for (const pid of placeholders) {
          const res = validateGoogleClientId(pid);
          expect(res.valid).toBe(false);
          expect(res.status).toBe('placeholder');
          expect(res.isPlaceholder).toBe(true);
          expect(res.reason).toContain('placeholder');
        }
      });

      it('detects malformed client IDs', () => {
        const malformed = [
          'invalid-id',
          'https://accounts.google.com/oauth2',
          'my-client-id.google.com',
          'not-ending-in-apps.com',
          'has spaces.apps.googleusercontent.com',
        ];

        for (const mid of malformed) {
          const res = validateGoogleClientId(mid);
          expect(res.valid).toBe(false);
          expect(res.status).toBe('malformed');
          expect(res.reason).toContain('format');
        }
      });

      it('accepts valid format Google Cloud client IDs', () => {
        const validIds = [
          '123456789012-abcdef123456.apps.googleusercontent.com',
          '9876543210-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com',
          'agentforge-official-desktop.apps.googleusercontent.com',
        ];

        for (const vid of validIds) {
          const res = validateGoogleClientId(vid);
          expect(res.valid).toBe(true);
          expect(res.status).toBe('valid');
        }
      });
    });

    describe('getStatus() reporting of validation and verification state', () => {
      it('reports missing client ID state', async () => {
        const service = new GoogleOAuthService({ credentialStore: memStore });
        const status = await service.getStatus();

        expect(status.clientConfigured).toBe(false);
        expect(status.clientValidation).toBe('missing');
        expect(status.clientVerified).toBe(false);
        expect(status.status).toBe('unconfigured');
      });

      it('reports placeholder client ID with warning diagnostic', async () => {
        process.env.GOOGLE_CLIENT_ID = 'custom-manager-client.apps.googleusercontent.com';
        const service = new GoogleOAuthService({ credentialStore: memStore });
        const status = await service.getStatus();

        expect(status.clientConfigured).toBe(true);
        expect(status.clientValidation).toBe('placeholder');
        expect(status.clientVerified).toBe(false);
        expect(status.clientValidationError).toContain('placeholder');
        expect(status.note).toContain('placeholder');

        delete process.env.GOOGLE_CLIENT_ID;
      });

      it('reports malformed client ID with warning diagnostic', async () => {
        process.env.GOOGLE_CLIENT_ID = 'malformed-google-client';
        const service = new GoogleOAuthService({ credentialStore: memStore });
        const status = await service.getStatus();

        expect(status.clientConfigured).toBe(true);
        expect(status.clientValidation).toBe('malformed');
        expect(status.clientVerified).toBe(false);
        expect(status.clientValidationError).toContain('format');

        delete process.env.GOOGLE_CLIENT_ID;
      });

      it('distinguishes syntax validity from Google verification', async () => {
        // Valid syntax, but no tokens exchanged yet -> clientVerified: false
        process.env.GOOGLE_CLIENT_ID = '123456789012-abcdef123456.apps.googleusercontent.com';
        const service = new GoogleOAuthService({ credentialStore: memStore });
        let status = await service.getStatus();

        expect(status.clientConfigured).toBe(true);
        expect(status.clientValidation).toBe('valid');
        expect(status.clientVerified).toBe(false);
        expect(status.status).toBe('configured');

        // Add valid stored tokens -> clientVerified: true, status: 'connected'
        await memStore.save('google', {
          provider: 'google',
          refreshToken: 'active-refresh-token',
          accessToken: 'active-access-token',
          expiresAt: Date.now() + 3600000,
          scopes: DEFAULT_MINIMAL_SCOPES,
          userEmail: 'verified.user@example.com',
          updatedAt: new Date().toISOString(),
        });

        status = await service.getStatus();
        expect(status.clientConfigured).toBe(true);
        expect(status.clientValidation).toBe('valid');
        expect(status.clientVerified).toBe(true);
        expect(status.accountConnected).toBe(true);
        expect(status.status).toBe('connected');

        delete process.env.GOOGLE_CLIENT_ID;
      });
    });

    describe('authenticateInteractive safety guards', () => {
      it('rejects placeholder client ID immediately before starting server or opening browser', async () => {
        process.env.GOOGLE_CLIENT_ID = 'custom-manager-client.apps.googleusercontent.com';
        const service = new GoogleOAuthService({ credentialStore: memStore });
        const browserSpy = vi.spyOn(service, 'openBrowser');

        await expect(service.authenticateInteractive()).rejects.toThrow(/placeholder/i);
        expect(browserSpy).not.toHaveBeenCalled();

        delete process.env.GOOGLE_CLIENT_ID;
      });

      it('rejects malformed client ID immediately before starting server or opening browser', async () => {
        process.env.GOOGLE_CLIENT_ID = 'malformed-id-without-domain';
        const service = new GoogleOAuthService({ credentialStore: memStore });
        const browserSpy = vi.spyOn(service, 'openBrowser');

        await expect(service.authenticateInteractive()).rejects.toThrow(/format/i);
        expect(browserSpy).not.toHaveBeenCalled();

        delete process.env.GOOGLE_CLIENT_ID;
      });
    });

    describe('saveDeveloperConfig and deleteDeveloperConfig', () => {
      it('rejects saving placeholder or malformed client IDs', async () => {
        const service = new GoogleOAuthService({ credentialStore: memStore });

        await expect(service.saveDeveloperConfig('custom-manager-client.apps.googleusercontent.com')).rejects.toThrow(
          /placeholder/i,
        );
        await expect(service.saveDeveloperConfig('malformed-client')).rejects.toThrow(/format/i);
      });

      it('saves valid client ID and supports deletion via deleteDeveloperConfig', async () => {
        const service = new GoogleOAuthService({ credentialStore: memStore });
        const validId = '123456789012-abcdef123456.apps.googleusercontent.com';

        const savedPath = await service.saveDeveloperConfig(validId, 'my-secret');
        expect(existsSync(savedPath)).toBe(true);
        expect(savedPath.startsWith(tempDir)).toBe(true); // Verifies isolation in tempDir

        const config = await service.getClientConfig();
        expect(config?.clientId).toBe(validId);
        expect(config?.source).toBe('config-file');

        const deleted = await service.deleteDeveloperConfig();
        expect(deleted).toBe(true);
        expect(existsSync(savedPath)).toBe(false);

        const configAfter = await service.getClientConfig();
        expect(configAfter).toBeNull();
      });
    });

    describe('Zero-Configuration Onboarding States (Milestone 7.1)', () => {
      it('reports "Not configured" when no publisher or developer credentials exist', async () => {
        const service = new GoogleOAuthService({ credentialStore: memStore });
        const status = await service.getStatus();

        expect(status.onboardingState).toBe('Not configured');
        expect(status.status).toBe('unconfigured');
        expect(status.clientConfigured).toBe(false);
        expect(status.actionRequiredReason).toBeUndefined();
        expect(status.publisherRequirement?.needed).toBe(true);
        expect(status.publisherRequirement?.status).toBe('pending-registration');
      });

      it('reports "Ready to connect" in zero-config mode when registered publisher client ID is set', async () => {
        process.env.AGENTFORGE_BUILTIN_CLIENT_ID = '123456789012-registeredpub.apps.googleusercontent.com';
        const service = new GoogleOAuthService({ credentialStore: memStore });
        const status = await service.getStatus();

        expect(status.onboardingState).toBe('Ready to connect');
        expect(status.status).toBe('configured');
        expect(status.clientConfigured).toBe(true);
        expect(status.authMode).toBe('zero-config');
        expect(status.accountConnected).toBe(false);
        expect(status.actionRequiredReason).toBeUndefined();

        delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
      });

      it('reports "Ready to connect" in developer mode when valid client ID is configured', async () => {
        process.env.GOOGLE_CLIENT_ID = '987654321098-developerclient.apps.googleusercontent.com';
        const service = new GoogleOAuthService({ credentialStore: memStore });
        const status = await service.getStatus();

        expect(status.onboardingState).toBe('Ready to connect');
        expect(status.status).toBe('configured');
        expect(status.clientConfigured).toBe(true);
        expect(status.authMode).toBe('developer-config');
        expect(status.accountConnected).toBe(false);

        delete process.env.GOOGLE_CLIENT_ID;
      });

      it('reports "Connected" when active credentials and tokens exist in storage', async () => {
        process.env.AGENTFORGE_BUILTIN_CLIENT_ID = '123456789012-registeredpub.apps.googleusercontent.com';
        await memStore.save('google', {
          provider: 'google',
          refreshToken: 'active-refresh-token',
          accessToken: 'active-access-token',
          expiresAt: Date.now() + 3600000,
          scopes: DEFAULT_MINIMAL_SCOPES,
          userEmail: 'user@example.com',
          updatedAt: new Date().toISOString(),
        });

        const service = new GoogleOAuthService({ credentialStore: memStore });
        const status = await service.getStatus();

        expect(status.onboardingState).toBe('Connected');
        expect(status.status).toBe('connected');
        expect(status.accountConnected).toBe(true);
        expect(status.connectedAccount).toBe('u**r@example.com');
        expect(status.actionRequiredReason).toBeUndefined();

        delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
      });

      it('reports "Connected" when access token is expired but valid refresh token exists', async () => {
        process.env.AGENTFORGE_BUILTIN_CLIENT_ID = '123456789012-registeredpub.apps.googleusercontent.com';
        await memStore.save('google', {
          provider: 'google',
          refreshToken: 'valid-refresh-token',
          accessToken: 'expired-access-token',
          expiresAt: Date.now() - 60000, // Expired 1 minute ago
          scopes: DEFAULT_MINIMAL_SCOPES,
          userEmail: 'user@example.com',
          updatedAt: new Date().toISOString(),
        });

        const service = new GoogleOAuthService({ credentialStore: memStore });
        const status = await service.getStatus();

        expect(status.onboardingState).toBe('Connected');
        expect(status.status).toBe('expired');
        expect(status.accountConnected).toBe(true);
        expect(status.actionRequiredReason).toBeUndefined();

        delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
      });

      it('reports "Action required" when token has been revoked', async () => {
        process.env.AGENTFORGE_BUILTIN_CLIENT_ID = '123456789012-registeredpub.apps.googleusercontent.com';
        await memStore.save('google', {
          provider: 'google',
          refreshToken: 'revoked-token',
          accessToken: undefined,
          expiresAt: 0, // Revoked indicator
          scopes: DEFAULT_MINIMAL_SCOPES,
          userEmail: 'revoked@example.com',
          updatedAt: new Date().toISOString(),
        });

        const service = new GoogleOAuthService({ credentialStore: memStore });
        const status = await service.getStatus();

        expect(status.onboardingState).toBe('Action required');
        expect(status.status).toBe('revoked');
        expect(status.accountConnected).toBe(false);
        expect(status.actionRequiredReason).toContain('revoked or expired');

        delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
      });

      it('reports "Action required" when client ID is placeholder or malformed', async () => {
        process.env.GOOGLE_CLIENT_ID = 'custom-manager-client.apps.googleusercontent.com';
        const service = new GoogleOAuthService({ credentialStore: memStore });
        const status = await service.getStatus();

        expect(status.onboardingState).toBe('Action required');
        expect(status.clientValidation).toBe('placeholder');
        expect(status.actionRequiredReason).toContain('placeholder');

        delete process.env.GOOGLE_CLIENT_ID;
      });
    });

    describe('Interactive OAuth Error Classification', () => {
      it('classifies invalid_client callback error with actionable guidance', async () => {
        process.env.GOOGLE_CLIENT_ID = '123456789012-validtest.apps.googleusercontent.com';
        const service = new GoogleOAuthService({
          credentialStore: memStore,
          customPort: 8948,
        });

        vi.spyOn(service, 'openBrowser').mockResolvedValue(true);
        const authPromise = service.authenticateInteractive({ timeoutMs: 3000 });
        const rejectAssertion = expect(authPromise).rejects.toThrow(
          /invalid_client.*Awaiting official publisher client registration/i,
        );

        await new Promise(r => setTimeout(r, 100));
        const resp = await fetch('http://127.0.0.1:8948/callback?error=invalid_client');
        expect(resp.status).toBe(400);

        await rejectAssertion;
        delete process.env.GOOGLE_CLIENT_ID;
      });

      it('classifies org_internal callback error with domain guidance', async () => {
        process.env.GOOGLE_CLIENT_ID = '123456789012-validtest.apps.googleusercontent.com';
        const service = new GoogleOAuthService({
          credentialStore: memStore,
          customPort: 8949,
        });

        vi.spyOn(service, 'openBrowser').mockResolvedValue(true);
        const authPromise = service.authenticateInteractive({ timeoutMs: 3000 });
        const rejectAssertion = expect(authPromise).rejects.toThrow(/internal domain users/i);

        await new Promise(r => setTimeout(r, 100));
        const resp = await fetch('http://127.0.0.1:8949/callback?error=org_internal');
        expect(resp.status).toBe(400);

        await rejectAssertion;
        delete process.env.GOOGLE_CLIENT_ID;
      });
    });
  });
});
