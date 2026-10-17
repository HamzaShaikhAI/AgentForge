/**
 * Reusable Google OAuth Service for AgentForge
 * Handles installed app OAuth 2.0 flow (loopback IP), PKCE, token refresh,
 * secure credential persistence, and integration status inspection.
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  GoogleClientConfig,
  GoogleConnectionStatus,
  GoogleOnboardingState,
  OAuthTokens,
  StoredCredentials,
  CredentialStore,
  ClientIdValidation,
  ClientIdValidationResult,
} from './types.js';
import { getDefaultCredentialStore, getAgentForgeDataDir } from './credential-store.js';
import { maskEmail, timingSafeStringEqual, sanitizeErrorString } from './redact.js';
import {
  PLACEHOLDER_PATTERNS,
  GOOGLE_CLIENT_ID_REGEX,
  STANDARD_GOOGLE_PROJECT_CLIENT_REGEX,
  validateGoogleClientId,
} from './client-validator.js';
import { getPublisherConfig, PUBLISHER_OAUTH_CONFIG } from './publisher-config.js';

export {
  PLACEHOLDER_PATTERNS,
  GOOGLE_CLIENT_ID_REGEX,
  STANDARD_GOOGLE_PROJECT_CLIENT_REGEX,
  validateGoogleClientId,
};

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export const DEFAULT_MINIMAL_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const YOUTUBE_SCOPES = [
  ...DEFAULT_MINIMAL_SCOPES,
  YOUTUBE_READONLY_SCOPE,
];
export const YOUTUBE_PUBLISH_SCOPES = [
  ...YOUTUBE_SCOPES,
  YOUTUBE_UPLOAD_SCOPE,
];

export interface GoogleOAuthOptions {
  credentialStore?: CredentialStore;
  clientConfig?: GoogleClientConfig;
  customPort?: number;
}

export class GoogleOAuthService {
  private store: CredentialStore;
  private clientConfigOverride?: GoogleClientConfig;
  private port: number;
  private isAuthenticating = false;

  constructor(options: GoogleOAuthOptions = {}) {
    this.store = options.credentialStore || getDefaultCredentialStore();
    this.clientConfigOverride = options.clientConfig;
    this.port = options.customPort || 8910;
  }

  /**
   * Resolve OAuth client configuration from built-in registered publisher client,
   * env vars, or local developer config files.
   * Never hardcodes secrets.
   */
  async getClientConfig(): Promise<GoogleClientConfig | null> {
    if (this.clientConfigOverride) {
      return this.clientConfigOverride;
    }

    // 0. Built-in Publisher Client (Zero-Configuration Mode)
    const publisherConfig = getPublisherConfig();
    if (publisherConfig.clientId) {
      return {
        clientId: publisherConfig.clientId.trim(),
        clientSecret: publisherConfig.clientSecret,
        source: 'builtin',
        isRegisteredPublisherClient: publisherConfig.isRegistered,
      };
    }

    // 1. Environment variables (Developer Mode)
    const envId = process.env.GOOGLE_CLIENT_ID;
    const envSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (envId) {
      return {
        clientId: envId.trim(),
        clientSecret: envSecret ? envSecret.trim() : undefined,
        source: 'env',
        isRegisteredPublisherClient: false,
      };
    }

    // 2. Candidate local file paths
    const candidates: string[] = [];
    if (process.env.GOOGLE_CLIENT_CONFIG) {
      candidates.push(process.env.GOOGLE_CLIENT_CONFIG);
    }

    const searchDirs: string[] = [];
    const dataDir = getAgentForgeDataDir();
    if (dataDir) searchDirs.push(dataDir);

    if (process.platform === 'win32' && process.env.APPDATA) {
      searchDirs.push(join(process.env.APPDATA, 'AgentForge'));
    }

    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (home) {
      searchDirs.push(join(home, '.agentforge'));
      searchDirs.push(join(home, '.config', 'agentforge'));
    }

    searchDirs.push(join(process.cwd(), '.agentforge'));
    searchDirs.push(process.cwd());

    for (const dir of searchDirs) {
      candidates.push(join(dir, 'google-client.json'));
      candidates.push(join(dir, 'client_secret.json'));

      // If directory exists, check for downloaded Google Cloud Console naming format: client_secret_*.json
      if (existsSync(dir)) {
        try {
          const files = await readdir(dir);
          for (const f of files) {
            if (/^client_secret.*\.json$/i.test(f)) {
              const fullPath = join(dir, f);
              if (!candidates.includes(fullPath)) {
                candidates.push(fullPath);
              }
            }
          }
        } catch {
          // ignore directory read errors
        }
      }
    }

    for (const filePath of candidates) {
      if (existsSync(filePath)) {
        try {
          const raw = await readFile(filePath, 'utf-8');
          const parsed = JSON.parse(raw);

          // Support standard Google Cloud Console downloaded JSON formats:
          // { "installed": { "client_id": "...", "client_secret": "..." } }
          // { "web": { "client_id": "...", "client_secret": "..." } }
          // Flat { "clientId": "...", "clientSecret": "..." }
          const target = parsed.installed || parsed.web || parsed;
          const clientId = target.client_id || target.clientId;
          const clientSecret = target.client_secret || target.clientSecret;

          if (clientId) {
            return {
              clientId: String(clientId).trim(),
              clientSecret: clientSecret ? String(clientSecret).trim() : undefined,
              source: 'config-file',
              configPath: filePath,
              isRegisteredPublisherClient: false,
            };
          }
        } catch {
          // Ignore invalid file and continue search
        }
      }
    }

    return null;
  }

  /**
   * Generate base64url PKCE verifier and challenge.
   */
  generatePKCE(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  /**
   * Construct the authorization URL with minimal scopes, state, and PKCE.
   */
  createAuthorizationUrl(
    config: GoogleClientConfig,
    redirectUri: string,
    state: string,
    challenge: string,
    scopes: string[] = DEFAULT_MINIMAL_SCOPES,
  ): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Check whether YouTube read-only scope has been authorized.
   */
  async isYouTubeAuthorized(): Promise<boolean> {
    return this.hasScopes([YOUTUBE_READONLY_SCOPE]);
  }

  /**
   * Check whether YouTube video upload scope has been authorized.
   */
  async isYouTubeUploadAuthorized(): Promise<boolean> {
    return this.hasScopes([YOUTUBE_UPLOAD_SCOPE]);
  }

  /**
   * Safely open a URL in the user's default browser.
   */
  async openBrowser(url: string): Promise<boolean> {
    try {
      if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', '', url.replace(/&/g, '^&')], { windowsHide: true });
        return true;
      } else if (process.platform === 'darwin') {
        spawn('open', [url]);
        return true;
      } else {
        spawn('xdg-open', [url]);
        return true;
      }
    } catch {
      return false;
    }
  }

  /**
   * Run the interactive OAuth flow using loopback redirect server.
   */
  async authenticateInteractive(options: {
    scopes?: string[];
    onPromptUrl?: (url: string) => void;
    timeoutMs?: number;
  } = {}): Promise<StoredCredentials> {
    const config = await this.getClientConfig();
    if (!config) {
      throw new Error(
        'Google OAuth client is not configured. Run "agentforge auth help" to see how to set up GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }

    const validation = validateGoogleClientId(config.clientId);
    if (!validation.valid) {
      throw new Error(
        `Cannot start Google authorization flow: ${validation.reason}\n` +
          'Please configure a valid Google Cloud Desktop OAuth Client ID:\n' +
          '  agentforge auth configure --client-id "<PROJECT_NUMBER>-<HASH>.apps.googleusercontent.com"\n' +
          'Or run "agentforge auth configure --reset" to clear stale credentials.',
      );
    }

    if (this.isAuthenticating) {
      throw new Error('Authentication is already in progress. Please complete or cancel the active sign-in flow.');
    }
    this.isAuthenticating = true;

    const scopes = options.scopes || DEFAULT_MINIMAL_SCOPES;
    const { verifier, challenge } = this.generatePKCE();
    const state = randomBytes(24).toString('base64url');
    const timeoutMs = options.timeoutMs || 180000; // 3 minutes timeout

    return new Promise<StoredCredentials>((resolveAuth, rejectAuth) => {
      let server: Server | null = null;
      let timer: NodeJS.Timeout | null = null;
      let isHandled = false;

      const cleanup = () => {
        this.isAuthenticating = false;
        if (timer) clearTimeout(timer);
        if (server) {
          server.close();
          server = null;
        }
      };

      server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
          // Reject repeated requests (replay / duplicate race conditions)
          if (isHandled) {
            res.writeHead(409, { 'Content-Type': 'text/plain' });
            res.end('Conflict: OAuth callback has already been processed.');
            return;
          }

          // Enforce GET method only
          if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method Not Allowed');
            return;
          }

          // Validate Host header to protect against DNS rebinding
          const host = (req.headers.host || '').split(':')[0].toLowerCase();
          if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden: Invalid Host header');
            cleanup();
            rejectAuth(new Error(`Rejected callback with untrusted Host: ${req.headers.host}`));
            return;
          }

          // Validate Origin header to block cross-origin requests from untrusted web pages
          const origin = req.headers.origin;
          if (
            origin &&
            origin !== 'null' &&
            !origin.startsWith('http://127.0.0.1') &&
            !origin.startsWith('http://localhost') &&
            !origin.endsWith('.google.com')
          ) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden: Cross-origin request rejected');
            cleanup();
            rejectAuth(new Error(`Rejected cross-origin callback from origin: ${origin}`));
            return;
          }

          const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
          if (reqUrl.pathname !== '/callback') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
          }

          isHandled = true;

          const error = reqUrl.searchParams.get('error');
          if (error) {
            const errorDescription = reqUrl.searchParams.get('error_description') || '';
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html><body style="font-family:sans-serif;padding:40px;background:#0f172a;color:#f87171;">
                <h2>Authentication Failed</h2>
                <p>Google returned an error: <strong>${error}</strong></p>
                ${errorDescription ? `<p style="color:#e2e8f0;">${errorDescription}</p>` : ''}
                <div style="margin-top:20px;padding:15px;background:#1e293b;border-radius:8px;color:#94a3b8;font-size:13px;line-height:1.5;">
                  <strong style="color:#f1f5f9;">Troubleshooting Guide:</strong>
                  <ul style="margin:8px 0 0 16px;padding:0;">
                    <li><strong>access_denied:</strong> You cancelled the prompt, or your account is not registered under "Test users" in Google Cloud Console while the app is in Testing mode.</li>
                    <li><strong>invalid_client:</strong> The OAuth Client ID was not found by Google. Awaiting official publisher registration or check Developer Mode credentials.</li>
                    <li><strong>unverified app interstitial:</strong> If Google displays "Google hasn't verified this app", click "Advanced" &gt; "Go to AgentForge (unsafe)".</li>
                  </ul>
                </div>
                <p style="color:#94a3b8;margin-top:20px;">You can close this tab and return to AgentForge.</p>
              </body></html>
            `);
            cleanup();
            if (error === 'access_denied') {
              if (/test/i.test(errorDescription) || /unverified/i.test(errorDescription) || /developer/i.test(errorDescription)) {
                rejectAuth(
                  new Error(
                    `Google test user restriction: ${errorDescription || 'While the app is in testing mode, only developer-approved test users can sign in.'}`,
                  ),
                );
              } else {
                rejectAuth(new Error('User denied consent during Google OAuth authorization.'));
              }
            } else if (error === 'invalid_client') {
              rejectAuth(
                new Error(
                  'The Google OAuth Client ID was rejected by Google (invalid_client). Awaiting official publisher client registration or check Developer Mode configuration.',
                ),
              );
            } else if (error === 'org_internal') {
              rejectAuth(new Error('The Google OAuth client is restricted to internal domain users.'));
            } else if (error === 'unauthorized_client') {
              rejectAuth(
                new Error(
                  'The OAuth client is not authorized for this flow (unauthorized_client). Ensure the client type is "Desktop app".',
                ),
              );
            } else {
              rejectAuth(new Error(`Google authorization error: ${error}${errorDescription ? ` (${errorDescription})` : ''}`));
            }
            return;
          }

          const callbackState = reqUrl.searchParams.get('state');
          if (!callbackState || !timingSafeStringEqual(callbackState, state)) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html><body style="font-family:sans-serif;padding:40px;background:#0f172a;color:#f87171;">
                <h2>Security Error</h2>
                <p>State parameter mismatch (possible CSRF attack). Authentication aborted.</p>
              </body></html>
            `);
            cleanup();
            rejectAuth(new Error('Invalid OAuth state parameter.'));
            return;
          }

          const code = reqUrl.searchParams.get('code');
          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html><body style="font-family:sans-serif;padding:40px;background:#0f172a;color:#f87171;">
                <h2>Missing Code</h2>
                <p>No authorization code received from Google.</p>
              </body></html>
            `);
            cleanup();
            rejectAuth(new Error('Missing authorization code from Google callback.'));
            return;
          }

          // Exchange authorization code for tokens
          const redirectUri = `http://127.0.0.1:${this.port}/callback`;
          const tokens = await this.exchangeCode(config, code, redirectUri, verifier);

          // Retrieve connected user's profile info
          const userInfo = await this.fetchUserInfo(tokens.accessToken);

          const storedCreds: StoredCredentials = {
            provider: 'google',
            refreshToken: tokens.refreshToken || '',
            accessToken: tokens.accessToken,
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes.length > 0 ? tokens.scopes : scopes,
            userEmail: userInfo.email,
            userId: userInfo.sub,
            updatedAt: new Date().toISOString(),
          };

          if (!storedCreds.refreshToken) {
            // Note: If Google didn't return a refresh token, it means consent prompt was bypassed
            // or offline access wasn't granted.
            const existing = await this.store.load('google');
            if (existing && existing.refreshToken) {
              storedCreds.refreshToken = existing.refreshToken;
            }
          }

          await this.store.save('google', storedCreds);

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html><body style="font-family:sans-serif;padding:40px;background:#0f172a;color:#e2e8f0;">
              <h2 style="color:#22c55e;">AgentForge Authentication Successful!</h2>
              <p>Connected account: <strong>${userInfo.email || 'Google User'}</strong></p>
              <p>Credentials saved to OS-protected secure storage.</p>
              <p style="color:#94a3b8;">You may now close this browser tab and return to Antigravity / terminal.</p>
            </body></html>
          `);

          cleanup();
          resolveAuth(storedCreds);
        } catch (err) {
          cleanup();
          rejectAuth(err as Error);
        }
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        cleanup();
        if (err.code === 'EADDRINUSE') {
          rejectAuth(
            new Error(
              `OAuth callback port ${this.port} is already in use by another application. Please close the conflicting application or configure a different port.`,
            ),
          );
        } else {
          rejectAuth(new Error(`OAuth callback server error: ${err.message}`));
        }
      });

      server.listen(this.port, '127.0.0.1', () => {
        const redirectUri = `http://127.0.0.1:${this.port}/callback`;
        const authUrl = this.createAuthorizationUrl(config, redirectUri, state, challenge, scopes);

        if (options.onPromptUrl) {
          options.onPromptUrl(authUrl);
        }
        this.openBrowser(authUrl);
      });

      timer = setTimeout(() => {
        cleanup();
        rejectAuth(new Error('Authentication timed out waiting for user approval.'));
      }, timeoutMs);
    });
  }

  /**
   * Exchange authorization code for tokens.
   */
  async exchangeCode(
    config: GoogleClientConfig,
    code: string,
    redirectUri: string,
    verifier: string,
  ): Promise<OAuthTokens> {
    const bodyParams = new URLSearchParams({
      code,
      client_id: config.clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    if (config.clientSecret) {
      bodyParams.set('client_secret', config.clientSecret);
    }

    const resp = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: bodyParams.toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let errorMsg = `HTTP ${resp.status}`;
      try {
        const errJson = JSON.parse(errText);
        errorMsg = errJson.error_description || errJson.error || errorMsg;
      } catch {
        errorMsg = errText || errorMsg;
      }
      const safeMsg = sanitizeErrorString(errorMsg, [config.clientSecret, code, verifier]);
      throw new Error(`Failed to exchange authorization code: ${safeMsg}`);
    }

    const data = (await resp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      id_token?: string;
      token_type?: string;
    };

    const expiresIn = data.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;
    const scopes = data.scope ? data.scope.split(' ') : [];

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn,
      expiresAt,
      scopes,
      idToken: data.id_token,
      tokenType: data.token_type || 'Bearer',
    };
  }

  /**
   * Refresh access token using stored refresh token.
   */
  async refreshAccessToken(refreshToken: string, config: GoogleClientConfig): Promise<OAuthTokens> {
    const bodyParams = new URLSearchParams({
      client_id: config.clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    if (config.clientSecret) {
      bodyParams.set('client_secret', config.clientSecret);
    }

    const resp = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: bodyParams.toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let errorMsg = `HTTP ${resp.status}`;
      let errorType = '';
      try {
        const errJson = JSON.parse(errText);
        errorType = errJson.error || '';
        errorMsg = errJson.error_description || errorType || errorMsg;
      } catch {
        // use raw
      }

      if (errorType === 'invalid_grant') {
        throw new Error('Google refresh token has expired or been revoked by the user.');
      }
      const safeMsg = sanitizeErrorString(errorMsg, [config.clientSecret, refreshToken]);
      throw new Error(`Failed to refresh Google access token: ${safeMsg}`);
    }

    const data = (await resp.json()) as {
      access_token: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };

    const expiresIn = data.expires_in || 3600;
    return {
      accessToken: data.access_token,
      expiresIn,
      expiresAt: Date.now() + expiresIn * 1000,
      scopes: data.scope ? data.scope.split(' ') : [],
      tokenType: data.token_type || 'Bearer',
    };
  }

  /**
   * Fetch user info from Google.
   */
  async fetchUserInfo(accessToken: string): Promise<{ email?: string; sub?: string; name?: string }> {
    try {
      const resp = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (resp.ok) {
        return (await resp.json()) as { email?: string; sub?: string; name?: string };
      }
    } catch {
      // Ignore userinfo failure; profile is optional metadata
    }
    return {};
  }

  /**
   * Obtain a valid access token for API requests, refreshing automatically if necessary.
   */
  async getValidAccessToken(): Promise<string> {
    const creds = await this.store.load('google');
    if (!creds || !creds.refreshToken) {
      throw new Error('No Google credentials found. Please run "agentforge auth google" first.');
    }

    const config = await this.getClientConfig();
    if (!config) {
      throw new Error('Google OAuth client configuration missing.');
    }

    // Refresh if within 5 minutes of expiration or missing access token
    const now = Date.now();
    const needsRefresh = !creds.accessToken || !creds.expiresAt || creds.expiresAt - now < 300000;

    if (needsRefresh) {
      try {
        const newTokens = await this.refreshAccessToken(creds.refreshToken, config);
        creds.accessToken = newTokens.accessToken;
        creds.expiresAt = newTokens.expiresAt;
        if (newTokens.scopes.length > 0) {
          creds.scopes = newTokens.scopes;
        }
        creds.updatedAt = new Date().toISOString();
        await this.store.save('google', creds);
      } catch (err: unknown) {
        const msg = (err as Error).message;
        if (msg.includes('expired or been revoked')) {
          // Keep the creds but clear the accessToken so status indicates revoked
          creds.accessToken = undefined;
          creds.expiresAt = 0;
          await this.store.save('google', creds);
        }
        throw err;
      }
    }

    return creds.accessToken!;
  }

  /**
   * Revoke credentials and remove from secure storage.
   */
  async logout(): Promise<{ revokedRemote: boolean; deletedLocal: boolean }> {
    let revokedRemote = false;
    const creds = await this.store.load('google');

    if (creds) {
      const tokenToRevoke = creds.refreshToken || creds.accessToken;
      if (tokenToRevoke) {
        try {
          const resp = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(tokenToRevoke)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          });
          revokedRemote = resp.ok;
        } catch {
          revokedRemote = false;
        }
      }
    }

    const deletedLocal = await this.store.delete('google');
    return { revokedRemote, deletedLocal };
  }

  /**
   * Verify if the currently stored credentials have the requested scopes.
   */
  async hasScopes(requiredScopes: string[]): Promise<boolean> {
    const creds = await this.store.load('google');
    if (!creds || !creds.scopes) return false;

    const granted = new Set(creds.scopes);
    return requiredScopes.every(scope => granted.has(scope));
  }

  /**
   * Report comprehensive Google connection status.
   * Never leaks secrets or raw tokens.
   */
  async getStatus(): Promise<GoogleConnectionStatus> {
    const clientConfig = await this.getClientConfig();
    const creds = await this.store.load('google');
    const backend = this.store.getBackendName();

    const clientValidation = validateGoogleClientId(clientConfig?.clientId);

    if (!clientConfig) {
      return {
        clientConfigured: false,
        clientValidation: 'missing',
        clientVerified: false,
        accountConnected: false,
        connectedAccount: null,
        status: 'unconfigured',
        onboardingState: 'Not configured',
        authMode: 'unconfigured',
        grantedScopes: [],
        available: false,
        note: 'Zero-configuration Google login is pending official publisher client registration. Use Developer Mode to configure credentials.',
        configSource: 'none',
        storageBackend: backend,
        publisherRequirement: {
          needed: true,
          status: 'pending-registration',
          description:
            'Zero-configuration Google Login requires an official AgentForge Desktop OAuth Client registered in Google Cloud Console.',
          steps: [
            'Register an AgentForge project in Google Cloud Console (https://console.cloud.google.com)',
            'Configure the OAuth Consent Screen (App Name: AgentForge, User support email, Developer contact)',
            'Create an OAuth 2.0 Client ID with Application Type: Desktop app',
            'Bundle the registered public Client ID with AgentForge distribution (AGENTFORGE_BUILTIN_CLIENT_ID)',
            'For development or self-hosting, provide your own client credentials via Manager UI or "agentforge auth configure"',
          ],
        },
      };
    }

    const authMode: GoogleConnectionStatus['authMode'] =
      clientConfig.source === 'builtin' || clientConfig.isRegisteredPublisherClient
        ? 'zero-config'
        : 'developer-config';

    if (!creds || !creds.refreshToken) {
      const note = !clientValidation.valid
        ? `Warning: Configured OAuth Client ID is ${clientValidation.status}. ${clientValidation.reason}`
        : authMode === 'zero-config'
        ? 'Ready to connect with zero-configuration Google login. Click "Connect Google" or run "agentforge auth google" to sign in.'
        : 'OAuth client configured in Developer Mode. Ready to connect. Run "agentforge auth google" to sign in.';

      return {
        clientConfigured: true,
        clientValidation: clientValidation.status,
        clientValidationError: clientValidation.reason,
        clientVerified: false,
        accountConnected: false,
        connectedAccount: null,
        status: 'configured',
        onboardingState: clientValidation.valid ? 'Ready to connect' : 'Action required',
        actionRequiredReason: clientValidation.valid ? undefined : clientValidation.reason,
        authMode,
        grantedScopes: [],
        available: false,
        note,
        configSource: clientConfig.source,
        storageBackend: backend,
      };
    }

    // Check if expired or revoked
    const isExpired = creds.expiresAt ? creds.expiresAt < Date.now() : false;
    const isRevoked = creds.expiresAt === 0 && !creds.accessToken;

    let state: GoogleConnectionStatus['status'] = 'connected';
    let onboardingState: GoogleConnectionStatus['onboardingState'] = 'Connected';
    let actionRequiredReason: string | undefined = undefined;
    let note = `Connected to ${maskEmail(creds.userEmail) || 'Google account'}. Refresh credentials stored in OS-protected storage.`;

    if (isRevoked) {
      state = 'revoked';
      onboardingState = 'Action required';
      actionRequiredReason = 'Google account connection was revoked or expired. Run "agentforge auth google" to re-authenticate.';
      note = actionRequiredReason;
    } else if (isExpired) {
      state = 'expired';
      onboardingState = 'Connected';
      note = 'Access token expired; will auto-refresh on next request using stored refresh token.';
    }

    if (!clientValidation.valid) {
      onboardingState = 'Action required';
      actionRequiredReason = clientValidation.reason || `Configured OAuth Client ID is ${clientValidation.status}.`;
      note = `Warning: Configured OAuth Client ID is ${clientValidation.status}. ${clientValidation.reason}`;
    }

    return {
      clientConfigured: true,
      clientValidation: clientValidation.status,
      clientValidationError: clientValidation.reason,
      clientVerified: !isRevoked,
      accountConnected: !isRevoked,
      connectedAccount: maskEmail(creds.userEmail),
      status: state,
      onboardingState,
      actionRequiredReason,
      authMode,
      grantedScopes: creds.scopes || [],
      // Available is false for specific service bridges (e.g. YouTube, Drive) until their APIs and actions are implemented
      available: false,
      note,
      configSource: clientConfig.source,
      storageBackend: backend,
    };
  }

  /**
   * Save developer client configuration locally outside the repository.
   */
  async saveDeveloperConfig(clientId: string, clientSecret?: string): Promise<string> {
    const trimmedId = clientId.trim();
    if (!trimmedId) {
      throw new Error('Client ID cannot be empty');
    }

    const validation = validateGoogleClientId(trimmedId);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    const configDir = getAgentForgeDataDir();
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(configDir, { recursive: true });

    const targetFile = join(configDir, 'google-client.json');
    const content = JSON.stringify(
      {
        installed: {
          client_id: trimmedId,
          ...(clientSecret?.trim() ? { client_secret: clientSecret.trim() } : {}),
        },
      },
      null,
      2,
    );

    await writeFile(targetFile, content, 'utf-8');
    return targetFile;
  }

  /**
   * Delete locally saved developer configuration file.
   */
  async deleteDeveloperConfig(): Promise<boolean> {
    const configDir = getAgentForgeDataDir();
    const targetFile = join(configDir, 'google-client.json');
    if (existsSync(targetFile)) {
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(targetFile);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}
