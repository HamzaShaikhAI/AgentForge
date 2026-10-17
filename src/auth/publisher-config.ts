/**
 * AgentForge Publisher OAuth Configuration
 *
 * Defines configuration for the official AgentForge Google Cloud Desktop application client.
 * In production releases, this supplies the verified client ID registered with Google Cloud.
 *
 * Architecture: Direct Native Desktop App Client (RFC 8252 / RFC 7636).
 * End users connect directly via loopback redirect (http://127.0.0.1:8910/callback) using PKCE.
 * No centralized broker or proxy server is used, preserving user privacy and local-first architecture.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGoogleClientId, PLACEHOLDER_PATTERNS } from './client-validator.js';
import { getAgentForgeDataDir } from './credential-store.js';

export { validateGoogleClientId, PLACEHOLDER_PATTERNS };

export interface PublisherOAuthConfig {
  /**
   * The registered Google Cloud OAuth 2.0 Client ID for the AgentForge Desktop app.
   * Format: <project-number>-<hash>.apps.googleusercontent.com
   */
  clientId?: string;

  /**
   * Optional client secret for public Desktop clients (if configured in Google Cloud Console).
   */
  clientSecret?: string;

  /**
   * Whether the publisher client has been registered and verified in Google Cloud Console.
   * When false, AgentForge reports status as 'Awaiting publisher configuration' / 'Not configured'.
   */
  isRegistered: boolean;

  /**
   * OAuth application type per RFC 8252 (OAuth 2.0 for Native Apps).
   */
  appType: 'Desktop app';

  /**
   * Google Cloud OAuth verification status.
   */
  verificationStatus: 'pending-publisher-registration' | 'in-review' | 'verified';

  /**
   * Loopback redirect URI used by AgentForge Desktop client.
   */
  redirectUri: string;

  /**
   * Publisher contact or issue tracker for verification inquiries.
   */
  supportContact: string;

  /**
   * Minimal default scopes requested on initial sign-in (non-sensitive).
   */
  defaultScopes: string[];

  /**
   * Incremental scopes requested on demand for specific bridge actions.
   */
  incrementalScopes: {
    youtubeReadOnly: string;
    youtubeUpload: string;
  };

  /**
   * Source where publisher configuration was resolved from.
   */
  source: 'bundled-file' | 'env' | 'code' | 'none';

  /**
   * Absolute path to the configuration file if resolved from disk.
   */
  configPath?: string;
}

/**
 * Embedded in-code release constant.
 * In production binary releases, this can be populated with the verified client ID.
 * In development checkouts, it defaults to undefined so fresh installs truthfully report
 * 'Awaiting publisher configuration'.
 */
export const BUNDLED_PUBLISHER_CLIENT_ID: string | undefined = undefined;

/**
 * Resolve publisher OAuth configuration from staging environment, bundled release files,
 * or default unconfigured state.
 *
 * Invariant: No placeholder or malformed client ID can ever activate isRegistered: true.
 */
export function getPublisherConfig(options?: { customSearchDirs?: string[] }): PublisherOAuthConfig {
  const baseConfig: Omit<
    PublisherOAuthConfig,
    'clientId' | 'clientSecret' | 'isRegistered' | 'verificationStatus' | 'source' | 'configPath'
  > = {
    appType: 'Desktop app',
    redirectUri: 'http://127.0.0.1:8910/callback',
    supportContact: 'https://github.com/HamzaShaikhAI/AgentForge/issues',
    defaultScopes: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    incrementalScopes: {
      youtubeReadOnly: 'https://www.googleapis.com/auth/youtube.readonly',
      youtubeUpload: 'https://www.googleapis.com/auth/youtube.upload',
    },
  };

  // 1. Staging / CI Environment variable override
  const envId = process.env.AGENTFORGE_BUILTIN_CLIENT_ID?.trim();
  if (envId) {
    const validation = validateGoogleClientId(envId);
    if (validation.valid) {
      return {
        ...baseConfig,
        clientId: envId,
        clientSecret: process.env.AGENTFORGE_BUILTIN_CLIENT_SECRET?.trim() || undefined,
        isRegistered: true,
        verificationStatus: 'verified',
        source: 'env',
      };
    } else {
      // If environment variable is a placeholder or malformed, do NOT mark as registered!
      return {
        ...baseConfig,
        clientId: envId,
        clientSecret: process.env.AGENTFORGE_BUILTIN_CLIENT_SECRET?.trim() || undefined,
        isRegistered: false,
        verificationStatus: 'pending-publisher-registration',
        source: 'env',
      };
    }
  }

  // 2. Bundled Package Configuration File (for packaged distributions / production releases)
  const candidateDirs: string[] = [];
  if (options?.customSearchDirs) {
    candidateDirs.push(...options.customSearchDirs);
  }

  try {
    const currentDir = typeof __dirname !== 'undefined'
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
    const packageRoot = resolve(currentDir, '..', '..');
    candidateDirs.push(packageRoot);
    candidateDirs.push(join(packageRoot, 'data'));
  } catch {
    // ignore directory resolution error
  }
  candidateDirs.push(process.cwd());
  candidateDirs.push(join(process.cwd(), 'data'));

  const dataDir = getAgentForgeDataDir();
  if (dataDir) {
    candidateDirs.push(dataDir);
  }

  for (const dir of candidateDirs) {
    for (const fileName of ['publisher-client.json', 'publisher.config.json']) {
      const filePath = join(dir, fileName);
      if (existsSync(filePath)) {
        try {
          const raw = readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(raw);
          const target = parsed.installed || parsed.desktop || parsed;
          const candidateId = String(target.client_id || target.clientId || '').trim();
          const candidateSecret = String(target.client_secret || target.clientSecret || '').trim() || undefined;

          if (candidateId) {
            const validation = validateGoogleClientId(candidateId);
            if (validation.valid) {
              return {
                ...baseConfig,
                clientId: candidateId,
                clientSecret: candidateSecret,
                isRegistered: true,
                verificationStatus: (parsed.verificationStatus as PublisherOAuthConfig['verificationStatus']) || 'verified',
                source: 'bundled-file',
                configPath: filePath,
              };
            } else {
              // Found bundled file but client ID is invalid or placeholder
              return {
                ...baseConfig,
                clientId: candidateId,
                clientSecret: candidateSecret,
                isRegistered: false,
                verificationStatus: 'pending-publisher-registration',
                source: 'bundled-file',
                configPath: filePath,
              };
            }
          }
        } catch {
          // ignore read/parse errors and continue checking candidates
        }
      }
    }
  }

  // 3. Bundled In-Code Release Constant (if compiled into binary/release)
  if (BUNDLED_PUBLISHER_CLIENT_ID && BUNDLED_PUBLISHER_CLIENT_ID.trim()) {
    const candidateId = BUNDLED_PUBLISHER_CLIENT_ID.trim();
    const validation = validateGoogleClientId(candidateId);
    if (validation.valid) {
      return {
        ...baseConfig,
        clientId: candidateId,
        isRegistered: true,
        verificationStatus: 'verified',
        source: 'code',
      };
    }
  }

  // 4. Default: Fresh install awaiting publisher registration
  return {
    ...baseConfig,
    clientId: undefined,
    isRegistered: false,
    verificationStatus: 'pending-publisher-registration',
    source: 'none',
  };
}

/**
 * Dynamic Proxy providing live access to the resolved publisher configuration.
 * Always reflects current environment variables or bundled files dynamically.
 */
export const PUBLISHER_OAUTH_CONFIG: PublisherOAuthConfig = new Proxy({} as PublisherOAuthConfig, {
  get(_target, prop) {
    const current = getPublisherConfig();
    return (current as unknown as Record<string, unknown>)[prop as string];
  },
});
