/**
 * X (Twitter) OAuth 2.0 Loopback Authentication Service for AgentForge
 * Handles installed app OAuth 2.0 with PKCE (RFC 7636 & RFC 8252 loopback IP),
 * state verification, token exchange, user identity inspection (/2/users/me),
 * and secure DPAPI persistence.
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  CredentialStore,
  StoredCredentials,
} from './types.js';
import { getDefaultCredentialStore, getAgentForgeDataDir } from './credential-store.js';
import { timingSafeStringEqual, sanitizeErrorString } from './redact.js';

export const X_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
export const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
export const X_USERINFO_URL = 'https://api.twitter.com/2/users/me';
export const DEFAULT_X_PORT = 43111;
export const DEFAULT_X_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'follows.read',
  'follows.write',
  'like.read',
  'like.write',
  'offline.access',
];

export interface XClientConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  source: 'env' | 'config-file' | 'direct';
  configPath?: string;
}

export interface XConnectionStatus {
  clientConfigured: boolean;
  accountConnected: boolean;
  connected: boolean;
  connectedAccount: string | null;
  accountName?: string | null;
  username?: string | null;
  userId: string | null;
  displayName: string | null;
  status: 'unconfigured' | 'configured' | 'connected' | 'expired';
  grantedScopes: string[];
  scopes?: string[];
  storageBackend: string;
  note: string;
  configSource: 'env' | 'config-file' | 'direct' | 'none';
}

export interface XOAuthOptions {
  credentialStore?: CredentialStore;
  clientConfig?: XClientConfig;
  customPort?: number;
  redirectUri?: string;
}

export class XOAuthService {
  private store: CredentialStore;
  private clientConfigOverride?: XClientConfig;
  private port: number;
  private redirectUriOverride?: string;
  private isAuthenticating = false;
  private activeCleanup: (() => void) | null = null;

  cancelActiveAuth(): boolean {
    if (this.activeCleanup) {
      try {
        this.activeCleanup();
      } catch {
        // Ignore close errors
      }
      this.activeCleanup = null;
    }
    this.isAuthenticating = false;
    return true;
  }

  constructor(optionsOrStore: XOAuthOptions | CredentialStore = {}) {
    if (optionsOrStore && typeof (optionsOrStore as CredentialStore).save === 'function') {
      this.store = optionsOrStore as CredentialStore;
      this.port = DEFAULT_X_PORT;
    } else {
      const options = (optionsOrStore || {}) as XOAuthOptions;
      this.store = options.credentialStore || getDefaultCredentialStore();
      this.clientConfigOverride = options.clientConfig;
      this.port = options.customPort || DEFAULT_X_PORT;
      this.redirectUriOverride = options.redirectUri;
    }
  }

  /**
   * Resolve X OAuth client credentials from override, env vars, or local config file.
   */
  async getClientConfig(): Promise<XClientConfig | null> {
    if (this.clientConfigOverride?.clientId) {
      return this.clientConfigOverride;
    }

    // 1. Environment variables
    const envId = (process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID)?.trim();
    const envSecret = (process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET)?.trim();
    const envRedirect = (process.env.X_REDIRECT_URI || process.env.TWITTER_REDIRECT_URI)?.trim();
    if (envId) {
      return {
        clientId: envId,
        clientSecret: envSecret || undefined,
        redirectUri: envRedirect || undefined,
        source: 'env',
      };
    }

    // 2. Local encrypted developer config file
    const configPath = join(getAgentForgeDataDir(), 'x-developer-config.json');
    if (existsSync(configPath)) {
      try {
        const raw = await readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.clientId) {
          return {
            clientId: parsed.clientId,
            clientSecret: parsed.clientSecret || undefined,
            redirectUri: parsed.redirectUri || undefined,
            source: 'config-file',
            configPath,
          };
        }
      } catch {
        // Ignore parse errors and fallback
      }
    }

    return null;
  }

  /**
   * Persist developer X OAuth Client ID & Secret to local config file.
   */
  async saveDeveloperConfig(clientId: string, clientSecret?: string, redirectUri?: string): Promise<string> {
    if (!clientId || typeof clientId !== 'string' || clientId.trim().length === 0) {
      throw new Error('X OAuth Client ID cannot be empty');
    }

    const dataDir = getAgentForgeDataDir();
    await mkdir(dataDir, { recursive: true });
    const configPath = join(dataDir, 'x-developer-config.json');

    const configData: Record<string, string> = {
      clientId: clientId.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (clientSecret && clientSecret.trim()) {
      configData.clientSecret = clientSecret.trim();
    }
    if (redirectUri && redirectUri.trim()) {
      configData.redirectUri = redirectUri.trim();
    }

    await writeFile(configPath, JSON.stringify(configData, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    return configPath;
  }

  /**
   * Delete developer X OAuth configuration file.
   */
  async deleteDeveloperConfig(): Promise<boolean> {
    const configPath = join(getAgentForgeDataDir(), 'x-developer-config.json');
    if (existsSync(configPath)) {
      await unlink(configPath);
      return true;
    }
    return false;
  }

  /**
   * Construct the X OAuth 2.0 PKCE authorization URL.
   */
  createAuthorizationUrl(
    config: XClientConfig,
    redirectUri: string,
    state: string,
    codeChallenge: string,
    scopes: string[] = DEFAULT_X_SCOPES,
  ): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${X_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Safely open a URL in the user's default browser (Google Chrome, Edge, etc.).
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
   * Run the interactive 1-click browser login flow with a local loopback server and PKCE.
   */
  async authenticateInteractive(options: {
    scopes?: string[];
    port?: number;
    redirectUri?: string;
    onPromptUrl?: (url: string) => void;
    timeoutMs?: number;
    clientConfig?: XClientConfig;
  } = {}): Promise<StoredCredentials> {
    const config = options.clientConfig || (await this.getClientConfig());
    if (!config || !config.clientId) {
      throw new Error(
        'X OAuth Client ID not found. Configure it in the AgentForge Web Manager or set $env:X_CLIENT_ID.',
      );
    }

    if (this.isAuthenticating) {
      this.cancelActiveAuth();
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    this.isAuthenticating = true;

    const port = options.port || this.port;
    const redirectUri =
      options.redirectUri ||
      this.redirectUriOverride ||
      config.redirectUri ||
      `http://localhost:${port}/callback`;

    const scopes = options.scopes || DEFAULT_X_SCOPES;
    const state = randomBytes(24).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const timeoutMs = options.timeoutMs || 180000;

    return new Promise<StoredCredentials>((resolveAuth, rejectAuth) => {
      let server: Server | null = null;
      let timer: NodeJS.Timeout | null = null;
      let isHandled = false;

      const cleanup = () => {
        this.isAuthenticating = false;
        this.activeCleanup = null;
        if (timer) clearTimeout(timer);
        if (server) {
          try {
            server.close();
          } catch {
            // Ignore close errors
          }
          server = null;
        }
      };
      this.activeCleanup = cleanup;

      server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (isHandled) {
            res.writeHead(409, { 'Content-Type': 'text/plain' });
            res.end('Conflict: Callback already processed.');
            return;
          }

          if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method Not Allowed');
            return;
          }

          const host = (req.headers.host || '').split(':')[0].toLowerCase();
          if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden: Invalid Host header');
            cleanup();
            rejectAuth(new Error(`Rejected callback with untrusted Host: ${req.headers.host}`));
            return;
          }

          const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
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
              <html><body style="font-family:system-ui,-apple-system,sans-serif;padding:40px;background:#0f172a;color:#f87171;display:flex;align-items:center;justify-content:center;min-height:80vh;">
                <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;max-width:480px;text-align:center;">
                  <h2 style="color:#ef4444;margin-top:0;">X Authorization Failed</h2>
                  <p>X returned an error: <strong>${error}</strong></p>
                  ${errorDescription ? `<p style="color:#94a3b8;font-size:13px;">${errorDescription}</p>` : ''}
                  <p style="color:#64748b;font-size:13px;margin-top:20px;">You can close this tab and return to AgentForge.</p>
                </div>
              </body></html>
            `);
            cleanup();
            rejectAuth(new Error(`X authorization failed: ${error}${errorDescription ? ` (${errorDescription})` : ''}`));
            return;
          }

          const callbackState = reqUrl.searchParams.get('state');
          if (!callbackState || !timingSafeStringEqual(callbackState, state)) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html><body style="font-family:system-ui,-apple-system,sans-serif;padding:40px;background:#0f172a;color:#f87171;display:flex;align-items:center;justify-content:center;min-height:80vh;">
                <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;max-width:480px;text-align:center;">
                  <h2 style="color:#ef4444;margin-top:0;">Security Error</h2>
                  <p>State parameter mismatch (possible CSRF attack). Authentication aborted.</p>
                </div>
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
              <html><body style="font-family:system-ui,-apple-system,sans-serif;padding:40px;background:#0f172a;color:#f87171;display:flex;align-items:center;justify-content:center;min-height:80vh;">
                <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;max-width:480px;text-align:center;">
                  <h2 style="color:#ef4444;margin-top:0;">Missing Authorization Code</h2>
                  <p>No authorization code received from X.</p>
                </div>
              </body></html>
            `);
            cleanup();
            rejectAuth(new Error('Missing authorization code from X callback.'));
            return;
          }

          // Exchange authorization code for token using PKCE
          const tokens = await this.exchangeCode(config, code, redirectUri, codeVerifier);

          // Fetch user profile info via /2/users/me
          const userInfo = await this.fetchUserInfo(tokens.accessToken);
          const userId = userInfo.id || 'unknown';
          const username = userInfo.username || 'x_user';
          const displayName = userInfo.name || username;

          const storedCreds: StoredCredentials = {
            provider: 'x',
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes.length > 0 ? tokens.scopes : scopes,
            userId,
            updatedAt: new Date().toISOString(),
            extraData: {
              userId,
              username,
              name: displayName,
              profileImageUrl: userInfo.profile_image_url,
            },
          };

          // Persist to secure OS storage (e.g. Windows DPAPI)
          await this.store.save('x', storedCreds);

          // Inject into active process environment
          process.env.X_ACCESS_TOKEN = tokens.accessToken;
          process.env.X_USER_ID = userId;
          process.env.TWITTER_ACCESS_TOKEN = tokens.accessToken;

          // Render sleek, dark-mode success page
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>AgentForge — X Connected</title>
              <style>
                body {
                  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  background: #090d16;
                  color: #f8fafc;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 90vh;
                  margin: 0;
                  padding: 20px;
                }
                .card {
                  background: #131b2e;
                  border: 1px solid #1e293b;
                  border-radius: 16px;
                  padding: 36px 32px;
                  max-width: 440px;
                  width: 100%;
                  text-align: center;
                  box-shadow: 0 20px 40px rgba(0,0,0,0.6);
                }
                .icon {
                  display: inline-flex;
                  align-items: center;
                  justify-content: center;
                  width: 56px;
                  height: 56px;
                  border-radius: 50%;
                  background: rgba(29, 155, 240, 0.15);
                  color: #1d9bf0;
                  font-size: 28px;
                  margin-bottom: 20px;
                  border: 1px solid rgba(29, 155, 240, 0.3);
                }
                h2 {
                  margin: 0 0 10px 0;
                  font-size: 22px;
                  font-weight: 700;
                  color: #ffffff;
                }
                p {
                  color: #94a3b8;
                  font-size: 14px;
                  margin: 0 0 24px 0;
                  line-height: 1.5;
                }
                .meta {
                  background: #0a0f1d;
                  border: 1px solid #1e293b;
                  border-radius: 10px;
                  padding: 14px 16px;
                  margin-bottom: 24px;
                  text-align: left;
                  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                  font-size: 12px;
                  color: #cbd5e1;
                }
                .meta-row {
                  display: flex;
                  justify-content: space-between;
                  margin-bottom: 6px;
                }
                .meta-row:last-child {
                  margin-bottom: 0;
                }
                .label {
                  color: #64748b;
                }
                .footer {
                  color: #64748b;
                  font-size: 13px;
                }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="icon">𝕏</div>
                <h2>X Connected!</h2>
                <p>AgentForge has successfully authorized your X account. Tokens are securely encrypted.</p>
                <div class="meta">
                  <div class="meta-row">
                    <span class="label">User:</span>
                    <span style="color:#1d9bf0;font-weight:bold;">@${username} (${displayName})</span>
                  </div>
                  <div class="meta-row">
                    <span class="label">User ID:</span>
                    <span>${userId}</span>
                  </div>
                  <div class="meta-row">
                    <span class="label">Scopes:</span>
                    <span>${tokens.scopes.join(', ') || 'default'}</span>
                  </div>
                </div>
                <div class="footer">You can now safely close this browser window.</div>
              </div>
            </body>
            </html>
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
              `OAuth callback port ${port} is already in use. Please close the conflicting application.`,
            ),
          );
        } else {
          rejectAuth(new Error(`OAuth callback server error: ${err.message}`));
        }
      });

      server.listen(port, '0.0.0.0', () => {
        const authUrl = this.createAuthorizationUrl(config, redirectUri, state, codeChallenge, scopes);

        if (options.onPromptUrl) {
          options.onPromptUrl(authUrl);
        }
        this.openBrowser(authUrl);
      });

      timer = setTimeout(() => {
        cleanup();
        rejectAuth(new Error('Authentication timed out waiting for X sign-in in browser.'));
      }, timeoutMs);
    });
  }

  /**
   * Exchange the authorization code for an OAuth access token using PKCE.
   */
  async exchangeCode(
    config: XClientConfig,
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes: string[];
  }> {
    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: config.clientId,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (config.clientSecret) {
      const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
      headers['Authorization'] = `Basic ${basic}`;
    }

    const response = await fetch(X_TOKEN_URL, {
      method: 'POST',
      headers,
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`X token exchange failed (${response.status}): ${errText}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!data.access_token) {
      throw new Error('X token response missing access_token.');
    }

    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined;

    const scopes = data.scope ? data.scope.split(' ') : [];

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      scopes,
    };
  }

  /**
   * Fetch authenticated user details from X API v2 /2/users/me.
   */
  async fetchUserInfo(accessToken: string): Promise<{
    id: string;
    name: string;
    username: string;
    profile_image_url?: string;
  }> {
    const url = `${X_USERINFO_URL}?user.fields=profile_image_url,description,public_metrics,verified`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to fetch X user profile (${response.status}): ${errText}`);
    }

    const body = await response.json() as {
      data?: {
        id: string;
        name: string;
        username: string;
        profile_image_url?: string;
      };
    };

    if (!body.data || !body.data.id) {
      throw new Error('X user profile response missing data.id.');
    }

    return body.data;
  }

  /**
   * Get current connection status and active credentials.
   */
  async getStatus(): Promise<XConnectionStatus> {
    const config = await this.getClientConfig();
    const clientConfigured = Boolean(config?.clientId);
    const configSource = config?.source || 'none';

    // 1. Check in-memory / environment variable first
    const envToken = (process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN)?.trim();
    if (envToken) {
      return {
        clientConfigured,
        accountConnected: true,
        connected: true,
        connectedAccount: process.env.X_USER_ID ? `@${process.env.X_USER_ID}` : 'X User (Env)',
        userId: process.env.X_USER_ID || null,
        displayName: 'X Account',
        username: process.env.X_USER_ID || 'x_user',
        status: 'connected',
        grantedScopes: DEFAULT_X_SCOPES,
        scopes: DEFAULT_X_SCOPES,
        storageBackend: 'environment-variable',
        note: 'Connected via X_ACCESS_TOKEN environment variable.',
        configSource,
      };
    }

    // 2. Check encrypted credential vault
    const creds = await this.store.load('x');
    const storageBackend = this.store.getBackendName();
    if (!creds || !creds.accessToken) {
      return {
        clientConfigured,
        accountConnected: false,
        connected: false,
        connectedAccount: null,
        userId: null,
        displayName: null,
        status: clientConfigured ? 'configured' : 'unconfigured',
        grantedScopes: [],
        storageBackend,
        note: clientConfigured
          ? 'X client is configured. Run interactive login to authorize an account.'
          : 'X client is unconfigured. Set Client ID or configure via Web Manager.',
        configSource,
      };
    }

    const isExpired = creds.expiresAt ? creds.expiresAt < Date.now() : false;
    const accountName = (creds.extraData?.name as string) || (creds.extraData?.username as string) || creds.userId || 'X Member';
    const username = (creds.extraData?.username as string) || creds.userId || null;

    return {
      clientConfigured,
      accountConnected: !isExpired,
      connected: !isExpired,
      connectedAccount: username ? `@${username}` : accountName,
      accountName,
      username,
      userId: creds.userId || null,
      displayName: accountName,
      status: isExpired ? 'expired' : 'connected',
      grantedScopes: creds.scopes || DEFAULT_X_SCOPES,
      scopes: creds.scopes || DEFAULT_X_SCOPES,
      storageBackend,
      note: isExpired
        ? 'Stored X credentials have expired. Please reconnect.'
        : `Connected to X as @${username || accountName}.`,
      configSource,
    };
  }

  /**
   * Remove stored X credentials from vault and environment.
   */
  async logout(): Promise<boolean> {
    delete process.env.X_ACCESS_TOKEN;
    delete process.env.X_USER_ID;
    delete process.env.TWITTER_ACCESS_TOKEN;
    return this.store.delete('x');
  }
}
