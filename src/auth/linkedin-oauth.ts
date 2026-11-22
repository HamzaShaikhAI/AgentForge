/**
 * LinkedIn OAuth 2.0 Loopback Authentication Service for AgentForge
 * Handles installed app OAuth 2.0 flow (RFC 8252 loopback IP), state verification,
 * token exchange, user identity inspection (/v2/userinfo), and secure DPAPI persistence.
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  CredentialStore,
  StoredCredentials,
} from './types.js';
import { getDefaultCredentialStore, getAgentForgeDataDir } from './credential-store.js';
import { maskEmail, timingSafeStringEqual, sanitizeErrorString } from './redact.js';

export const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
export const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
export const DEFAULT_LINKEDIN_PORT = 43110;
export const DEFAULT_LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'];

export interface LinkedInClientConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  source: 'env' | 'config-file' | 'direct';
  configPath?: string;
}

export interface LinkedInConnectionStatus {
  clientConfigured: boolean;
  accountConnected: boolean;
  connected: boolean;
  connectedAccount: string | null;
  accountName?: string | null;
  accountEmail?: string | null;
  personUrn: string | null;
  displayName: string | null;
  status: 'unconfigured' | 'configured' | 'connected' | 'expired';
  grantedScopes: string[];
  scopes?: string[];
  storageBackend: string;
  note: string;
  configSource: 'env' | 'config-file' | 'direct' | 'none';
}

export interface LinkedInOAuthOptions {
  credentialStore?: CredentialStore;
  clientConfig?: LinkedInClientConfig;
  customPort?: number;
  redirectUri?: string;
}

export class LinkedInOAuthService {
  private store: CredentialStore;
  private clientConfigOverride?: LinkedInClientConfig;
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
      this.isAuthenticating = false;
      return true;
    }
    this.isAuthenticating = false;
    return false;
  }

  constructor(optionsOrStore: LinkedInOAuthOptions | CredentialStore = {}) {
    if (optionsOrStore && typeof (optionsOrStore as CredentialStore).save === 'function') {
      this.store = optionsOrStore as CredentialStore;
      this.port = DEFAULT_LINKEDIN_PORT;
    } else {
      const options = (optionsOrStore || {}) as LinkedInOAuthOptions;
      this.store = options.credentialStore || getDefaultCredentialStore();
      this.clientConfigOverride = options.clientConfig;
      this.port = options.customPort || DEFAULT_LINKEDIN_PORT;
      this.redirectUriOverride = options.redirectUri;
    }
  }

  /**
   * Resolve LinkedIn OAuth client credentials from override, env vars, or local config file.
   */
  async getClientConfig(): Promise<LinkedInClientConfig | null> {
    if (this.clientConfigOverride?.clientId) {
      return this.clientConfigOverride;
    }

    // 1. Environment variables
    const envId = process.env.LINKEDIN_CLIENT_ID?.trim();
    const envSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
    const envRedirect = process.env.LINKEDIN_REDIRECT_URI?.trim();
    if (envId) {
      return {
        clientId: envId,
        clientSecret: envSecret || undefined,
        redirectUri: envRedirect || undefined,
        source: 'env',
      };
    }

    // 2. Candidate local file paths
    const candidates: string[] = [];
    const dataDir = getAgentForgeDataDir();
    if (dataDir) candidates.push(join(dataDir, 'linkedin-client.json'));

    if (process.platform === 'win32' && process.env.APPDATA) {
      candidates.push(join(process.env.APPDATA, 'AgentForge', 'linkedin-client.json'));
    }

    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (home) {
      candidates.push(join(home, '.agentforge', 'linkedin-client.json'));
      candidates.push(join(home, '.config', 'agentforge', 'linkedin-client.json'));
    }

    candidates.push(join(process.cwd(), '.agentforge', 'linkedin-client.json'));
    candidates.push(join(process.cwd(), 'linkedin-client.json'));

    for (const filePath of candidates) {
      if (existsSync(filePath)) {
        try {
          const raw = await readFile(filePath, 'utf-8');
          const parsed = JSON.parse(raw);
          const target = parsed.installed || parsed.web || parsed;
          const clientId = target.client_id || target.clientId;
          const clientSecret = target.client_secret || target.clientSecret;
          const redirectUri = target.redirect_uri || target.redirectUri;

          if (clientId) {
            return {
              clientId: String(clientId).trim(),
              clientSecret: clientSecret ? String(clientSecret).trim() : undefined,
              redirectUri: redirectUri ? String(redirectUri).trim() : undefined,
              source: 'config-file',
              configPath: filePath,
            };
          }
        } catch {
          // ignore corrupted files
        }
      }
    }

    return null;
  }

  /**
   * Construct the LinkedIn OAuth 2.0 authorization URL.
   */
  createAuthorizationUrl(
    configOrOptions: LinkedInClientConfig | { redirectUri?: string; state?: string; scopes?: string[] },
    redirectUri?: string,
    state?: string,
    scopes: string[] = DEFAULT_LINKEDIN_SCOPES,
  ): string {
    let clientId = '';
    let rUri = redirectUri || '';
    let st = state || '';
    let sc = scopes;

    if ('clientId' in configOrOptions) {
      clientId = configOrOptions.clientId;
    } else {
      clientId = process.env.LINKEDIN_CLIENT_ID || this.clientConfigOverride?.clientId || '';
      rUri = configOrOptions.redirectUri || rUri;
      st = configOrOptions.state || st;
      sc = configOrOptions.scopes || sc;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: rUri,
      state: st,
      scope: sc.join(' '),
    });

    return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
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
   * Run the interactive 1-click browser login flow with a local loopback server.
   */
  async authenticateInteractive(options: {
    scopes?: string[];
    port?: number;
    redirectUri?: string;
    onPromptUrl?: (url: string) => void;
    timeoutMs?: number;
    clientConfig?: LinkedInClientConfig;
  } = {}): Promise<StoredCredentials> {
    const config = options.clientConfig || (await this.getClientConfig());
    if (!config || !config.clientId) {
      throw new Error(
        'LinkedIn OAuth Client ID not found. Run "agentforge auth configure-linkedin --client-id <ID> --client-secret <SECRET>" or set $env:LINKEDIN_CLIENT_ID.',
      );
    }
    if (!config.clientSecret) {
      throw new Error(
        'LinkedIn OAuth Client Secret is required for token exchange. Provide it via configure-linkedin or $env:LINKEDIN_CLIENT_SECRET.',
      );
    }

    if (this.isAuthenticating) {
      this.cancelActiveAuth();
      // Allow previous loopback socket a moment to release cleanly
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    this.isAuthenticating = true;

    const port = options.port || this.port;
    const redirectUri =
      options.redirectUri ||
      this.redirectUriOverride ||
      config.redirectUri ||
      `http://localhost:${port}/callback`;

    const scopes = options.scopes || DEFAULT_LINKEDIN_SCOPES;
    const state = randomBytes(24).toString('base64url');
    const timeoutMs = options.timeoutMs || 180000; // 3 minutes timeout

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
                  <h2 style="color:#ef4444;margin-top:0;">LinkedIn Authorization Failed</h2>
                  <p>LinkedIn returned an error: <strong>${error}</strong></p>
                  ${errorDescription ? `<p style="color:#94a3b8;font-size:13px;">${errorDescription}</p>` : ''}
                  <p style="color:#64748b;font-size:13px;margin-top:20px;">You can close this tab and return to AgentForge.</p>
                </div>
              </body></html>
            `);
            cleanup();
            rejectAuth(new Error(`LinkedIn authorization failed: ${error}${errorDescription ? ` (${errorDescription})` : ''}`));
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
                  <p>No authorization code received from LinkedIn.</p>
                </div>
              </body></html>
            `);
            cleanup();
            rejectAuth(new Error('Missing authorization code from LinkedIn callback.'));
            return;
          }

          // Exchange authorization code for token
          const tokens = await this.exchangeCode(config, code, redirectUri);

          // Fetch user profile info
          const userInfo = await this.fetchUserInfo(tokens.accessToken);
          const sub = userInfo.sub || 'user';
          const personUrn = sub.startsWith('urn:li:person:') ? sub : `urn:li:person:${sub}`;
          const displayName = userInfo.name || 'LinkedIn Member';

          const storedCreds: StoredCredentials = {
            provider: 'linkedin',
            accessToken: tokens.accessToken,
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes.length > 0 ? tokens.scopes : scopes,
            userEmail: userInfo.email,
            userId: sub,
            updatedAt: new Date().toISOString(),
            extraData: {
              personUrn,
              name: displayName,
              picture: userInfo.picture,
            },
          };

          // Persist to secure OS storage (e.g. Windows DPAPI)
          await this.store.save('linkedin', storedCreds);

          // Inject into active process environment
          process.env.LINKEDIN_ACCESS_TOKEN = tokens.accessToken;
          process.env.LINKEDIN_PERSON_URN = personUrn;

          // Render sleek, dark-mode success page in Chrome
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>AgentForge — LinkedIn Connected</title>
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
                  width: 64px;
                  height: 64px;
                  border-radius: 50%;
                  background: rgba(14, 165, 233, 0.15);
                  color: #38bdf8;
                  font-size: 32px;
                  margin-bottom: 20px;
                }
                h2 {
                  color: #f8fafc;
                  margin: 0 0 8px 0;
                  font-size: 22px;
                  font-weight: 600;
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
                <div class="icon">✓</div>
                <h2>LinkedIn Connected!</h2>
                <p>AgentForge has successfully authorized your LinkedIn account. Tokens are securely encrypted.</p>
                <div class="meta">
                  <div class="meta-row">
                    <span class="label">Member:</span>
                    <span style="color:#38bdf8;font-weight:bold;">${displayName}</span>
                  </div>
                  <div class="meta-row">
                    <span class="label">Person URN:</span>
                    <span>${personUrn}</span>
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
        const authUrl = this.createAuthorizationUrl(config, redirectUri, state, scopes);

        if (options.onPromptUrl) {
          options.onPromptUrl(authUrl);
        }
        this.openBrowser(authUrl);
      });

      timer = setTimeout(() => {
        cleanup();
        rejectAuth(new Error('Authentication timed out waiting for LinkedIn sign-in in browser.'));
      }, timeoutMs);
    });
  }

  /**
   * Exchange the authorization code for an OAuth access token.
   */
  async exchangeCode(
    config: LinkedInClientConfig,
    code: string,
    redirectUri: string,
  ): Promise<{
    accessToken: string;
    expiresIn: number;
    expiresAt: number;
    scopes: string[];
  }> {
    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret || '',
    });

    const resp = await fetch(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
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
      const safeMsg = sanitizeErrorString(errorMsg, [config.clientSecret, code]);
      throw new Error(`Failed to exchange LinkedIn authorization code: ${safeMsg}`);
    }

    const data = (await resp.json()) as {
      access_token: string;
      expires_in?: number;
      scope?: string;
    };

    const expiresIn = data.expires_in || 5184000; // default 60 days
    const expiresAt = Date.now() + expiresIn * 1000;
    const scopes = data.scope ? data.scope.split(/[\s,]+/).filter(Boolean) : DEFAULT_LINKEDIN_SCOPES;

    return {
      accessToken: data.access_token,
      expiresIn,
      expiresAt,
      scopes,
    };
  }

  /**
   * Fetch member profile via OIDC /v2/userinfo.
   */
  async fetchUserInfo(accessToken: string): Promise<{
    sub?: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    email?: string;
    picture?: string;
  }> {
    try {
      const resp = await fetch(LINKEDIN_USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (resp.ok) {
        return (await resp.json()) as {
          sub?: string;
          name?: string;
          given_name?: string;
          family_name?: string;
          email?: string;
          picture?: string;
        };
      }
    } catch {
      // Userinfo fetch failure fallback
    }
    return {};
  }

  /**
   * Check connection status.
   */
  async getStatus(): Promise<LinkedInConnectionStatus> {
    const clientConfig = await this.getClientConfig();
    const creds = await this.store.load('linkedin');
    const backend = this.store.getBackendName();

    const envToken = process.env.LINKEDIN_ACCESS_TOKEN?.trim();
    const envPersonUrn = process.env.LINKEDIN_PERSON_URN?.trim();

    if (envToken && envPersonUrn) {
      return {
        clientConfigured: Boolean(clientConfig),
        accountConnected: true,
        connected: true,
        connectedAccount: 'Active session (via environment variables)',
        accountName: 'LinkedIn User',
        accountEmail: null,
        personUrn: envPersonUrn,
        displayName: 'LinkedIn User',
        status: 'connected',
        grantedScopes: DEFAULT_LINKEDIN_SCOPES,
        scopes: DEFAULT_LINKEDIN_SCOPES,
        storageBackend: 'environment-variables',
        note: 'Connected using LINKEDIN_ACCESS_TOKEN and LINKEDIN_PERSON_URN environment variables.',
        configSource: 'env',
      };
    }

    if (creds && creds.accessToken) {
      const isExpired = creds.expiresAt ? creds.expiresAt < Date.now() : false;
      const personUrn =
        (creds.extraData?.personUrn as string) ||
        (creds.userId ? `urn:li:person:${creds.userId}` : null);
      const displayName = (creds.extraData?.name as string) || creds.userEmail || 'LinkedIn Member';

      return {
        clientConfigured: Boolean(clientConfig),
        accountConnected: !isExpired,
        connected: !isExpired,
        connectedAccount: creds.userEmail ? maskEmail(creds.userEmail) : displayName,
        accountName: displayName,
        accountEmail: creds.userEmail || null,
        personUrn,
        displayName,
        status: isExpired ? 'expired' : 'connected',
        grantedScopes: creds.scopes || DEFAULT_LINKEDIN_SCOPES,
        scopes: creds.scopes || DEFAULT_LINKEDIN_SCOPES,
        storageBackend: backend,
        note: isExpired
          ? 'LinkedIn access token expired. Run "agentforge auth linkedin" to re-authenticate in Chrome.'
          : `Connected to LinkedIn as ${displayName} (${personUrn || 'no URN'}).`,
        configSource: clientConfig?.source || 'direct',
      };
    }

    if (!clientConfig) {
      return {
        clientConfigured: false,
        accountConnected: false,
        connected: false,
        connectedAccount: null,
        accountName: null,
        accountEmail: null,
        personUrn: null,
        displayName: null,
        status: 'unconfigured',
        grantedScopes: [],
        scopes: [],
        storageBackend: backend,
        note: 'LinkedIn OAuth client is not configured. Provide Client ID & Secret to enable 1-click browser login.',
        configSource: 'none',
      };
    }

    return {
      clientConfigured: true,
      accountConnected: false,
      connected: false,
      connectedAccount: null,
      accountName: null,
      accountEmail: null,
      personUrn: null,
      displayName: null,
      status: 'configured',
      grantedScopes: [],
      scopes: [],
      storageBackend: backend,
      note: 'LinkedIn client credentials configured. Ready to connect via 1-click browser login.',
      configSource: clientConfig.source,
    };
  }

  /**
   * Log out and delete stored LinkedIn credentials.
   */
  async logout(): Promise<boolean> {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_PERSON_URN;
    return this.store.delete('linkedin');
  }

  /**
   * Save developer client credentials locally outside the git repository.
   */
  async saveDeveloperConfig(clientId: string, clientSecret?: string, redirectUri?: string): Promise<string> {
    const trimmedId = clientId.trim();
    if (!trimmedId) {
      throw new Error('Client ID cannot be empty');
    }

    const configDir = getAgentForgeDataDir();
    await mkdir(configDir, { recursive: true });

    const targetFile = join(configDir, 'linkedin-client.json');
    const content = JSON.stringify(
      {
        client_id: trimmedId,
        ...(clientSecret?.trim() ? { client_secret: clientSecret.trim() } : {}),
        ...(redirectUri?.trim() ? { redirect_uri: redirectUri.trim() } : {}),
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
    const targetFile = join(configDir, 'linkedin-client.json');
    if (existsSync(targetFile)) {
      try {
        await unlink(targetFile);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}
