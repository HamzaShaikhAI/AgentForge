import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPublisherConfig,
  PUBLISHER_OAUTH_CONFIG,
  validateGoogleClientId,
  PLACEHOLDER_PATTERNS,
} from './publisher-config.js';
import { GoogleOAuthService } from './google-oauth.js';
import { MemoryCredentialStore } from './credential-store.js';

describe('Publisher OAuth Configuration & Production Readiness', () => {
  let tempDir: string;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    savedEnv = { ...process.env };
    tempDir = await mkdtemp(join(tmpdir(), 'agentforge-pub-config-'));

    // Clear all auth-related environment variables for a clean test baseline
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_CONFIG;
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
    delete process.env.AGENTFORGE_BUILTIN_CLIENT_SECRET;
    delete process.env.AGENTFORGE_DATA_DIR;
  });

  afterEach(async () => {
    process.env = savedEnv;
    vi.restoreAllMocks();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('validateGoogleClientId', () => {
    it('rejects empty, null, or undefined values', () => {
      expect(validateGoogleClientId(undefined)).toEqual({
        valid: false,
        status: 'missing',
        reason: 'OAuth Client ID is missing or empty.',
      });
      expect(validateGoogleClientId('')).toEqual({
        valid: false,
        status: 'missing',
        reason: 'OAuth Client ID is missing or empty.',
      });
      expect(validateGoogleClientId('   ')).toEqual({
        valid: false,
        status: 'missing',
        reason: 'OAuth Client ID is missing or empty.',
      });
    });

    it('rejects known placeholder and dummy client IDs', () => {
      const placeholders = [
        'custom-manager-client.apps.googleusercontent.com',
        'your-client-id.apps.googleusercontent.com',
        'placeholder.apps.googleusercontent.com',
        'example.apps.googleusercontent.com',
        'dummy.apps.googleusercontent.com',
        '<client-id>.apps.googleusercontent.com',
        'xxxxxxxxx.apps.googleusercontent.com',
        'custom-sample-client.apps.googleusercontent.com',
      ];

      for (const id of placeholders) {
        const result = validateGoogleClientId(id);
        expect(result.valid).toBe(false);
        expect(result.status).toBe('placeholder');
        expect(result.isPlaceholder).toBe(true);
        expect(result.reason).toContain('dummy or test placeholder');
      }
    });

    it('rejects malformed client IDs that do not match Google domain format', () => {
      const malformed = [
        'not-a-google-id',
        'https://accounts.google.com/o/oauth2',
        'myproject.google.com',
        '12345.apps.evil.com',
      ];

      for (const id of malformed) {
        const result = validateGoogleClientId(id);
        expect(result.valid).toBe(false);
        expect(result.status).toBe('malformed');
        expect(result.reason).toContain('does not match the Google Cloud OAuth client ID format');
      }
    });

    it('accepts legitimate Google Cloud Desktop client IDs', () => {
      const valid = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
      const result = validateGoogleClientId(valid);
      expect(result.valid).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.reason).toBeUndefined();
    });
  });

  describe('getPublisherConfig (Resolution & Fallback)', () => {
    it('defaults to unconfigured state on fresh installations without env or files', () => {
      const config = getPublisherConfig({ customSearchDirs: [tempDir] });
      expect(config.isRegistered).toBe(false);
      expect(config.source).toBe('none');
      expect(config.clientId).toBeUndefined();
      expect(config.verificationStatus).toBe('pending-publisher-registration');
      expect(config.appType).toBe('Desktop app');
      expect(config.redirectUri).toBe('http://127.0.0.1:8910/callback');
    });

    it('resolves bundled publisher-client.json from package/app directory with zero env vars', async () => {
      const validClientId = '987654321098-abcdefghijklmnopqrstuvwxyz67890.apps.googleusercontent.com';
      const bundledFilePath = join(tempDir, 'publisher-client.json');
      await writeFile(
        bundledFilePath,
        JSON.stringify({
          installed: {
            client_id: validClientId,
            client_secret: 'bundled-desktop-secret',
          },
          verificationStatus: 'verified',
        }),
      );

      const config = getPublisherConfig({ customSearchDirs: [tempDir] });
      expect(config.isRegistered).toBe(true);
      expect(config.source).toBe('bundled-file');
      expect(config.clientId).toBe(validClientId);
      expect(config.clientSecret).toBe('bundled-desktop-secret');
      expect(config.verificationStatus).toBe('verified');
      expect(config.configPath).toBe(bundledFilePath);
    });

    it('strictly marks isRegistered: false when bundled file contains a placeholder', async () => {
      const bundledFilePath = join(tempDir, 'publisher-client.json');
      await writeFile(
        bundledFilePath,
        JSON.stringify({
          installed: {
            client_id: 'custom-manager-client.apps.googleusercontent.com',
          },
        }),
      );

      const config = getPublisherConfig({ customSearchDirs: [tempDir] });
      expect(config.isRegistered).toBe(false);
      expect(config.source).toBe('bundled-file');
      expect(config.clientId).toBe('custom-manager-client.apps.googleusercontent.com');
      expect(config.verificationStatus).toBe('pending-publisher-registration');
    });

    it('resolves AGENTFORGE_BUILTIN_CLIENT_ID from environment for CI/staging', () => {
      const validClientId = '112233445566-validstagingclient.apps.googleusercontent.com';
      process.env.AGENTFORGE_BUILTIN_CLIENT_ID = validClientId;
      process.env.AGENTFORGE_BUILTIN_CLIENT_SECRET = 'staging-secret';

      const config = getPublisherConfig();
      expect(config.isRegistered).toBe(true);
      expect(config.source).toBe('env');
      expect(config.clientId).toBe(validClientId);
      expect(config.clientSecret).toBe('staging-secret');
      expect(config.verificationStatus).toBe('verified');
    });

    it('strictly marks isRegistered: false when AGENTFORGE_BUILTIN_CLIENT_ID is a placeholder', () => {
      process.env.AGENTFORGE_BUILTIN_CLIENT_ID = 'custom-manager-client.apps.googleusercontent.com';

      const config = getPublisherConfig();
      expect(config.isRegistered).toBe(false);
      expect(config.source).toBe('env');
      expect(config.verificationStatus).toBe('pending-publisher-registration');
    });

    it('PUBLISHER_OAUTH_CONFIG dynamic proxy reflects changes dynamically', () => {
      expect(PUBLISHER_OAUTH_CONFIG.isRegistered).toBe(false);

      process.env.AGENTFORGE_BUILTIN_CLIENT_ID = '999888777666-proxyclient.apps.googleusercontent.com';
      expect(PUBLISHER_OAUTH_CONFIG.isRegistered).toBe(true);
      expect(PUBLISHER_OAUTH_CONFIG.clientId).toBe('999888777666-proxyclient.apps.googleusercontent.com');
      expect(PUBLISHER_OAUTH_CONFIG.source).toBe('env');

      delete process.env.AGENTFORGE_BUILTIN_CLIENT_ID;
      expect(PUBLISHER_OAUTH_CONFIG.isRegistered).toBe(false);
    });
  });

  describe('End-to-End Onboarding & State Transitions', () => {
    it('fresh install reports "Not configured" with publisher requirement details', async () => {
      const memStore = new MemoryCredentialStore();
      const oauthService = new GoogleOAuthService({ credentialStore: memStore });

      const status = await oauthService.getStatus();
      expect(status.onboardingState).toBe('Not configured');
      expect(status.authMode).toBe('unconfigured');
      expect(status.clientConfigured).toBe(false);
      expect(status.accountConnected).toBe(false);
      expect(status.publisherRequirement?.needed).toBe(true);
      expect(status.publisherRequirement?.status).toBe('pending-registration');
      expect(status.publisherRequirement?.steps.length).toBeGreaterThan(0);
    });

    it('bundled production client ID enables "Ready to connect" without user env vars', async () => {
      const validClientId = '123456789012-productionapp.apps.googleusercontent.com';
      process.env.AGENTFORGE_BUILTIN_CLIENT_ID = validClientId;

      const memStore = new MemoryCredentialStore();
      const oauthService = new GoogleOAuthService({ credentialStore: memStore });

      const status = await oauthService.getStatus();
      expect(status.onboardingState).toBe('Ready to connect');
      expect(status.authMode).toBe('zero-config');
      expect(status.clientConfigured).toBe(true);
      expect(status.clientValidation).toBe('valid');
      expect(status.clientValidationError).toBeUndefined();
      expect(status.accountConnected).toBe(false);
      expect(status.note).toContain('Ready to connect with zero-configuration Google login');
    });

    it('placeholder client ID forces "Action required" and forbids "Ready to connect"', async () => {
      process.env.AGENTFORGE_BUILTIN_CLIENT_ID = 'custom-manager-client.apps.googleusercontent.com';

      const memStore = new MemoryCredentialStore();
      const oauthService = new GoogleOAuthService({ credentialStore: memStore });

      const status = await oauthService.getStatus();
      expect(status.onboardingState).toBe('Action required');
      expect(status.clientConfigured).toBe(true);
      expect(status.clientValidation).toBe('placeholder');
      expect(status.actionRequiredReason).toContain('dummy or test placeholder');
    });

    it('handles test user restriction callback gracefully', async () => {
      process.env.AGENTFORGE_BUILTIN_CLIENT_ID = '123456789012-validproduction.apps.googleusercontent.com';
      const memStore = new MemoryCredentialStore();
      const oauthService = new GoogleOAuthService({
        credentialStore: memStore,
        customPort: 8955,
      });

      vi.spyOn(oauthService, 'openBrowser').mockResolvedValue(true);
      const authPromise = oauthService.authenticateInteractive({ timeoutMs: 3000 });
      const rejectAssertion = expect(authPromise).rejects.toThrow(
        /Google test user restriction/i,
      );

      await new Promise(r => setTimeout(r, 100));
      const resp = await fetch(
        'http://127.0.0.1:8955/callback?error=access_denied&error_description=Developer+mode+test+users+only',
      );
      expect(resp.status).toBe(400);

      await rejectAssertion;
    });

    it('handles unauthorized_client callback with desktop app client type guidance', async () => {
      process.env.AGENTFORGE_BUILTIN_CLIENT_ID = '123456789012-validproduction.apps.googleusercontent.com';
      const memStore = new MemoryCredentialStore();
      const oauthService = new GoogleOAuthService({
        credentialStore: memStore,
        customPort: 8956,
      });

      vi.spyOn(oauthService, 'openBrowser').mockResolvedValue(true);
      const authPromise = oauthService.authenticateInteractive({ timeoutMs: 3000 });
      const rejectAssertion = expect(authPromise).rejects.toThrow(
        /unauthorized_client.*Ensure the client type is "Desktop app"/i,
      );

      await new Promise(r => setTimeout(r, 100));
      const resp = await fetch('http://127.0.0.1:8956/callback?error=unauthorized_client');
      expect(resp.status).toBe(400);

      await rejectAssertion;
    });
  });
});
