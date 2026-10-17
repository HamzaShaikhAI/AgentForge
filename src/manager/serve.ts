import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname, normalize } from 'node:path';
import { BridgeRegistry } from '../bridge-registry.js';
import { BridgeValidator } from '../bridge-validator.js';
import { GitExecutor } from '../executors/git-executor.js';
import { YouTubeExecutor, StandardStepExecutor } from '../executors/index.js';
import { GoogleOAuthService, YOUTUBE_SCOPES, YOUTUBE_PUBLISH_SCOPES } from '../auth/google-oauth.js';
import { McpManager } from '../mcp/mcp-manager.js';
import { IntegrationCatalog } from '../catalog.js';
import { WorkflowEngine } from '../workflow-engine.js';
import { PermissionManager } from '../permissions.js';
import { WorkflowDefinition, WorkflowStep } from '../types.js';
import { redactObject } from '../auth/redact.js';
import { BridgeBuilder } from '../builder/index.js';

export const DEFAULT_PORT = 9470;
const ROOT = resolve(import.meta.dirname, '..', '..');
const MANAGER_DIR = join(ROOT, 'manager');
const BRIDGES_DIR = join(ROOT, 'bridges');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Verify that the request is local and not an unauthorized cross-site or DNS-rebinding request.
 */
function isAuthorizedLocalRequest(req: IncomingMessage): { authorized: boolean; reason?: string } {
  // 1. Host header validation: must be loopback
  const host = req.headers.host || '';
  const hostName = host.split(':')[0].toLowerCase();
  if (hostName && hostName !== 'localhost' && hostName !== '127.0.0.1' && hostName !== '[::1]') {
    return { authorized: false, reason: 'Forbidden: Host header must be loopback (localhost or 127.0.0.1)' };
  }

  // 2. Cross-Origin validation for state-changing requests
  const method = req.method?.toUpperCase();
  if (method === 'POST' || method === 'DELETE' || method === 'PUT' || method === 'PATCH') {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const originHost = originUrl.hostname.toLowerCase();
        if (originHost !== 'localhost' && originHost !== '127.0.0.1' && originHost !== '[::1]') {
          return { authorized: false, reason: `Forbidden: Cross-site request from origin "${origin}" is prohibited` };
        }
      } catch {
        return { authorized: false, reason: 'Forbidden: Malformed Origin header' };
      }
    }

    const referer = req.headers.referer;
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        const refererHost = refererUrl.hostname.toLowerCase();
        if (refererHost !== 'localhost' && refererHost !== '127.0.0.1' && refererHost !== '[::1]') {
          return { authorized: false, reason: `Forbidden: Cross-site request from referer "${referer}" is prohibited` };
        }
      } catch {
        return { authorized: false, reason: 'Forbidden: Malformed Referer header' };
      }
    }
  }

  return { authorized: true };
}

/**
 * Read request body safely with a maximum byte limit to prevent DoS.
 */
function readRequestBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        rejectPromise(new Error('Payload too large'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf-8');
    });
    req.on('end', () => resolvePromise(body));
    req.on('error', rejectPromise);
  });
}

export function createManagerServer(
  port = DEFAULT_PORT,
  googleOAuth = new GoogleOAuthService(),
  mcpManager = new McpManager(),
  workflowEngine?: WorkflowEngine,
  permissionManager?: PermissionManager,
  bridgeBuilder?: BridgeBuilder,
): Server {
  const registry = new BridgeRegistry(BRIDGES_DIR);
  const validator = new BridgeValidator();
  const gitExecutor = new GitExecutor();
  const youtubeExecutor = new YouTubeExecutor({ googleOAuth });
  const stepExecutor = new StandardStepExecutor({ gitExecutor, mcpManager, youtubeExecutor });
  const catalog = new IntegrationCatalog(registry, mcpManager, gitExecutor, googleOAuth);
  const permissions = permissionManager || new PermissionManager();
  mcpManager.setPermissionManager(permissions);
  const engine = workflowEngine || new WorkflowEngine(registry, permissions, {
    mcpManager,
    executor: stepExecutor,
    storageDir: join(ROOT, 'data', 'workflows'),
  });

  const effectiveStepExecutor = (engine.getExecutor() instanceof StandardStepExecutor)
    ? (engine.getExecutor() as StandardStepExecutor)
    : stepExecutor;

  const builder = bridgeBuilder || new BridgeBuilder({
    projectRoot: ROOT,
    bridgesDir: BRIDGES_DIR,
    registry,
    catalog,
    mcpManager,
    stepExecutor: effectiveStepExecutor,
  });

  // Register starter / predefined workflows
  const PREDEFINED_WORKFLOWS: WorkflowDefinition[] = [
    {
      id: 'git-status-check',
      name: 'Git Status & Working Tree Review',
      description: 'Inspect current Git branch, uncommitted changes, and latest commits (Read-Only)',
      steps: [
        {
          id: 'inspect-status',
          name: 'Inspect Status',
          bridge: 'github',
          action: 'status-check',
          inputs: {},
        },
        {
          id: 'inspect-diff',
          name: 'Inspect Diff',
          bridge: 'github',
          action: 'diff-review',
          inputs: {},
          dependsOn: ['inspect-status'],
        },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'workspace-audit',
      name: 'Workspace Code & Commit Audit',
      description: 'Inspects repository metadata, commit logs, and working tree changes (Read-Only)',
      steps: [
        {
          id: 'repo-metadata',
          name: 'Inspect Repository Metadata',
          bridge: 'github',
          action: 'repo-info',
          inputs: {},
        },
        {
          id: 'recent-commits',
          name: 'Inspect Recent Commits',
          bridge: 'github',
          action: 'log-inspect',
          inputs: {
            count: 5,
          },
          dependsOn: ['repo-metadata'],
        },
        {
          id: 'status-summary',
          name: 'Check Working Tree Cleanliness',
          bridge: 'github',
          action: 'status-check',
          inputs: {},
          dependsOn: ['recent-commits'],
        },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'git-release-pipeline',
      name: 'Production Git Release Pipeline with Approvals',
      description: 'Prepares changelog, checks working tree, creates local tag, and pushes to remote with operator approval checkpoints',
      steps: [
        {
          id: 'verify-status',
          name: 'Verify Working Tree Status',
          bridge: 'github',
          action: 'status-check',
          inputs: {},
        },
        {
          id: 'generate-changelog',
          name: 'Prepare Release Changelog',
          bridge: 'github',
          action: 'changelog-prepare',
          inputs: {
            from: 'HEAD~10',
            to: 'HEAD',
          },
          dependsOn: ['verify-status'],
        },
        {
          id: 'create-tag',
          name: 'Create Local Git Tag',
          bridge: 'github',
          action: 'tag-create',
          inputs: {
            name: 'v1.0.0-rc1',
            message: 'Release Candidate v1.0.0-rc1',
          },
          dependsOn: ['generate-changelog'],
        },
        {
          id: 'push-release-tag',
          name: 'Push Tag to Remote (Requires Approval)',
          bridge: 'github',
          action: 'push-tags',
          inputs: {
            remote: 'origin',
            tag: 'v1.0.0-rc1',
            dryRun: true,
          },
          dependsOn: ['create-tag'],
        },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'mock-release-pipeline',
      name: 'Simulated Release Pipeline with Approval Checkpoint',
      description: 'Demonstrates multi-step workflow pausing for user approval before publishing',
      steps: [
        {
          id: 'check-repo',
          name: 'Check Repository Status',
          bridge: 'github',
          action: 'status-check',
          inputs: {},
        },
        {
          id: 'review-diff',
          name: 'Review Code Changes',
          bridge: 'github',
          action: 'diff-review',
          inputs: {},
          dependsOn: ['check-repo'],
        },
        {
          id: 'publish-release',
          name: 'Publish Staged Artifact',
          bridge: 'example-echo',
          action: 'publish-example',
          inputs: {
            target: 'npm-registry',
          },
          dependsOn: ['review-diff'],
        },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'youtube-channel-inspect',
      name: 'YouTube Channel & Video Inspection',
      description: 'Inspect authenticated YouTube channel statistics and list recent uploaded videos',
      steps: [
        {
          id: 'inspect-channel',
          name: 'Inspect YouTube Channel',
          bridge: 'youtube',
          action: 'channel-inspect',
          inputs: {},
        },
        {
          id: 'list-videos',
          name: 'List Uploaded Videos',
          bridge: 'youtube',
          action: 'video-list',
          inputs: {
            maxResults: 5,
          },
          dependsOn: ['inspect-channel'],
        },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'youtube-video-publish',
      name: 'YouTube Video Publish Pipeline',
      description: 'Inspect channel details, stage video metadata, and publish video with explicit operator approval checkpoint',
      steps: [
        {
          id: 'inspect-target-channel',
          name: 'Inspect Target Channel',
          bridge: 'youtube',
          action: 'channel-inspect',
          inputs: {},
        },
        {
          id: 'publish-video',
          name: 'Upload and Publish Video (Requires Approval)',
          bridge: 'youtube',
          action: 'video-upload',
          inputs: {
            filePath: join(ROOT, 'examples', 'sample-video.mp4'),
            title: 'AgentForge Getting Started',
            description: 'Automated video upload orchestrated by AgentForge workflow engine with approval checkpoint.',
            privacyStatus: 'private',
            tags: ['agentforge', 'automation', 'developer-tools'],
            categoryId: '22',
            defaultLanguage: 'en',
          },
          dependsOn: ['inspect-target-channel'],
        },
      ],
      createdAt: new Date().toISOString(),
    },
  ];

  for (const wf of PREDEFINED_WORKFLOWS) {
    engine.registerWorkflow(wf);
  }

  interface ManagerAuditEntry {
    id: string;
    runId?: string;
    stepId?: string;
    provider: string;
    action: string;
    status: 'approved' | 'rejected';
    approvedBy?: string;
    rejectedBy?: string;
    reason?: string;
    timestamp: string;
  }
  const auditEntries: ManagerAuditEntry[] = [];

  const server = createServer(async (req, res) => {
    // Basic security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // Local loopback and CSRF protection
    const authCheck = isAuthorizedLocalRequest(req);
    if (!authCheck.authorized) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: authCheck.reason }));
      return;
    }

    const rawUrl = req.url ?? '/';
    let url: URL;
    try {
      url = new URL(rawUrl, `http://localhost:${port}`);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Malformed URL' }));
      return;
    }

    // ─── API Routes ───────────────────────────────────────────────

    // GET /api/status - Health check
    if (req.method === 'GET' && url.pathname === '/api/status') {
      await registry.discover();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        version: '0.1.0',
        bridgesCount: registry.list().length,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // GET /api/bridges - List installed bridges
    if (req.method === 'GET' && url.pathname === '/api/bridges') {
      try {
        await registry.discover();
        const bridges = registry.list();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bridges));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Failed to load bridges: ${(err as Error).message}` }));
      }
      return;
    }

    // POST /api/validate - Validate a bridge manifest draft
    if (req.method === 'POST' && url.pathname === '/api/validate') {
      try {
        const body = await readRequestBody(req);
        const result = validator.validateJSON(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          valid: false,
          errors: [{ field: '(request)', message: (err as Error).message }],
          warnings: [],
        }));
      }
      return;
    }

    // GET /api/integrations - Check system tools and credentials
    if (req.method === 'GET' && url.pathname === '/api/integrations') {
      let gitOk = false;
      let gitVersion = '';
      try {
        const { stdout } = await gitExecutor.runGit(['--version']);
        gitOk = true;
        gitVersion = stdout;
      } catch {
        // Git missing
      }

      const googleStatus = await googleOAuth.getStatus();
      const hasYouTubeScope = await googleOAuth.isYouTubeAuthorized();
      const hasYouTubeUploadScope = await googleOAuth.isYouTubeUploadAuthorized();

      const status = {
        git: { available: gitOk, version: gitVersion, required: true },
        githubCli: { available: false, version: '', required: false, notes: 'Not installed. Optional.' },
        githubToken: {
          configured: Boolean(process.env.GITHUB_TOKEN),
          required: false,
          notes: process.env.GITHUB_TOKEN ? 'Token set via GITHUB_TOKEN environment variable' : 'Missing GITHUB_TOKEN environment variable',
        },
        google: {
          clientConfigured: googleStatus.clientConfigured,
          clientValidation: googleStatus.clientValidation,
          clientValidationError: googleStatus.clientValidationError,
          clientVerified: googleStatus.clientVerified,
          accountConnected: googleStatus.accountConnected,
          connectedAccount: googleStatus.connectedAccount,
          status: googleStatus.status,
          onboardingState: googleStatus.onboardingState,
          actionRequiredReason: googleStatus.actionRequiredReason,
          authMode: googleStatus.authMode,
          grantedScopes: googleStatus.grantedScopes,
          available: googleStatus.available,
          storageBackend: googleStatus.storageBackend,
          notes: googleStatus.note,
          configSource: googleStatus.configSource,
          publisherRequirement: googleStatus.publisherRequirement,
        },
        youtube: {
          available: Boolean(googleStatus.accountConnected && hasYouTubeScope),
          configured: googleStatus.clientConfigured,
          connected: Boolean(googleStatus.accountConnected),
          hasScope: hasYouTubeScope,
          hasUploadScope: hasYouTubeUploadScope,
          connectedAccount: googleStatus.connectedAccount,
          notes: !googleStatus.accountConnected
            ? 'Requires Google Account connection'
            : !hasYouTubeScope
            ? 'Google account connected, but YouTube read-only scope not granted'
            : hasYouTubeUploadScope
            ? `Connected via Google Account (${googleStatus.connectedAccount}) with YouTube read and upload permissions`
            : `Connected via Google Account (${googleStatus.connectedAccount}) with YouTube read-only scope`,
        },
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // GET /api/auth/google/status - Google OAuth connection status
    if (req.method === 'GET' && url.pathname === '/api/auth/google/status') {
      const status = await googleOAuth.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // POST /api/auth/google/connect - Interactive Google OAuth Login
    if (req.method === 'POST' && url.pathname === '/api/auth/google/connect') {
      try {
        const currentStatus = await googleOAuth.getStatus();
        if (currentStatus.onboardingState === 'Not configured') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'not_configured',
            onboardingState: 'Not configured',
            message: 'Zero-configuration Google login is pending official publisher client registration. Use Developer Mode to configure credentials.',
            publisherRequirement: currentStatus.publisherRequirement,
          }));
          return;
        }

        if (currentStatus.onboardingState === 'Action required' && currentStatus.clientValidation !== 'valid') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'invalid_client_config',
            onboardingState: 'Action required',
            message: currentStatus.actionRequiredReason || 'OAuth Client ID configuration is invalid.',
          }));
          return;
        }

        const creds = await googleOAuth.authenticateInteractive({
          timeoutMs: 120000,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          account: creds.userEmail || 'Google User',
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: (err as Error).message,
        }));
      }
      return;
    }

    // POST /api/auth/youtube/connect - Interactive Google OAuth with YouTube scopes
    if (req.method === 'POST' && url.pathname === '/api/auth/youtube/connect') {
      try {
        const currentStatus = await googleOAuth.getStatus();
        if (currentStatus.onboardingState === 'Not configured') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'not_configured',
            onboardingState: 'Not configured',
            message: 'Google OAuth client is unconfigured. Awaiting publisher registration or configure credentials in Developer Mode.',
            publisherRequirement: currentStatus.publisherRequirement,
          }));
          return;
        }

        if (currentStatus.onboardingState === 'Action required' && currentStatus.clientValidation !== 'valid') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'invalid_client_config',
            onboardingState: 'Action required',
            message: currentStatus.actionRequiredReason || 'OAuth Client ID configuration is invalid.',
          }));
          return;
        }

        const creds = await googleOAuth.authenticateInteractive({
          scopes: YOUTUBE_SCOPES,
          timeoutMs: 120000,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          account: creds.userEmail || 'Google User',
          hasYouTubeScope: true,
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: (err as Error).message,
        }));
      }
      return;
    }

    // POST /api/auth/youtube/connect-upload - Interactive Google OAuth with YouTube upload scope
    if (req.method === 'POST' && url.pathname === '/api/auth/youtube/connect-upload') {
      try {
        const currentStatus = await googleOAuth.getStatus();
        if (currentStatus.onboardingState === 'Not configured') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'not_configured',
            onboardingState: 'Not configured',
            message: 'Google OAuth client is unconfigured. Awaiting publisher registration or configure credentials in Developer Mode.',
            publisherRequirement: currentStatus.publisherRequirement,
          }));
          return;
        }

        if (currentStatus.onboardingState === 'Action required' && currentStatus.clientValidation !== 'valid') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'invalid_client_config',
            onboardingState: 'Action required',
            message: currentStatus.actionRequiredReason || 'OAuth Client ID configuration is invalid.',
          }));
          return;
        }

        const creds = await googleOAuth.authenticateInteractive({
          scopes: YOUTUBE_PUBLISH_SCOPES,
          timeoutMs: 120000,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          account: creds.userEmail || 'Google User',
          hasYouTubeScope: true,
          hasUploadScope: true,
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: (err as Error).message,
        }));
      }
      return;
    }

    // POST /api/auth/google/logout - Disconnect Google Account
    if (req.method === 'POST' && url.pathname === '/api/auth/google/logout') {
      try {
        const result = await googleOAuth.logout();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          revokedRemote: result.revokedRemote,
          deletedLocal: result.deletedLocal,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: (err as Error).message,
        }));
      }
      return;
    }

    // POST /api/auth/google/configure - Save Developer OAuth Credentials
    if (req.method === 'POST' && url.pathname === '/api/auth/google/configure') {
      try {
        const bodyStr = await readRequestBody(req);
        let body: { clientId?: string; clientSecret?: string } = {};
        try {
          body = JSON.parse(bodyStr);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Malformed JSON payload' }));
          return;
        }

        if (!body.clientId || typeof body.clientId !== 'string' || !body.clientId.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'clientId is required and must be non-empty' }));
          return;
        }

        const savedPath = await googleOAuth.saveDeveloperConfig(body.clientId, body.clientSecret);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Developer credentials saved successfully',
          configPath: savedPath,
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/auth/google/reset - Remove local developer credentials
    if (req.method === 'POST' && url.pathname === '/api/auth/google/reset') {
      try {
        const deleted = await googleOAuth.deleteDeveloperConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          deletedConfig: deleted,
          message: deleted ? 'Developer configuration removed successfully' : 'No developer configuration file found',
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // GET /api/catalog - Unified Integration Catalog
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      try {
        const catalogData = await catalog.getCatalog();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(catalogData));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // GET /api/truth/capabilities - System-wide Capability Truth Report
    if (req.method === 'GET' && url.pathname === '/api/truth/capabilities') {
      try {
        const report = await catalog.getTruthEngine().generateSystemTruthReport();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, report }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // GET /api/catalog/presets - List or search curated MCP presets
    if (req.method === 'GET' && url.pathname === '/api/catalog/presets') {
      try {
        const q = url.searchParams.get('q') || undefined;
        const category = url.searchParams.get('category') || undefined;
        const presets = catalog.getPresets(q, category);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(presets));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // POST /api/catalog/presets/install - Install and configure a curated MCP preset
    if (req.method === 'POST' && url.pathname === '/api/catalog/presets/install') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        const presetId = body.presetId || body.id;
        if (!presetId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'presetId is required' }));
          return;
        }
        const state = await catalog.installPreset(presetId, {
          env: body.env,
          customArgs: body.customArgs || body.args,
        });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, server: state }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // GET /api/mcp/servers - List configured MCP servers
    if (req.method === 'GET' && url.pathname === '/api/mcp/servers') {
      const servers = mcpManager.listServers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(servers));
      return;
    }

    // POST /api/mcp/servers - Add a new MCP server
    if (req.method === 'POST' && url.pathname === '/api/mcp/servers') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        const state = await mcpManager.addServer(body);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, server: state }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/mcp/servers/:id/connect
    const connectMatch = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/connect$/);
    if (req.method === 'POST' && connectMatch) {
      const serverId = decodeURIComponent(connectMatch[1]);
      try {
        const state = await mcpManager.connectServer(serverId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, server: state }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/mcp/servers/:id/disconnect
    const disconnectMatch = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/disconnect$/);
    if (req.method === 'POST' && disconnectMatch) {
      const serverId = decodeURIComponent(disconnectMatch[1]);
      try {
        const state = await mcpManager.disconnectServer(serverId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, server: state }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/mcp/servers/:id/test (Ping)
    const testMatch = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/test$/);
    if (req.method === 'POST' && testMatch) {
      const serverId = decodeURIComponent(testMatch[1]);
      try {
        const alive = await mcpManager.pingServer(serverId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, serverId, alive }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // DELETE /api/mcp/servers/:id - Remove MCP server
    const deleteMatch = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)$/);
    if (req.method === 'DELETE' && deleteMatch) {
      const serverId = decodeURIComponent(deleteMatch[1]);
      try {
        const removed = await mcpManager.removeServer(serverId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, serverId, removed }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/mcp/tools/call - Invoke tool on external MCP server
    if (req.method === 'POST' && url.pathname === '/api/mcp/tools/call') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        if (!body.serverId || !body.toolName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'serverId and toolName are required' }));
          return;
        }

        const result = await mcpManager.callTool(body.serverId, body.toolName, body.inputs || {});
        const statusCode = result.status === 'blocked' ? 403 : result.status === 'error' ? 500 : 200;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // ─── Workflow Run API Endpoints (Milestone 5C) ────────────────

    // GET /api/workflows/predefined - List predefined starter workflows
    if (req.method === 'GET' && url.pathname === '/api/workflows/predefined') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(PREDEFINED_WORKFLOWS.map(wf => ({ ...wf, stepCount: wf.steps.length }))));
      return;
    }

    // GET /api/workflows/runs - List workflow runs
    if (req.method === 'GET' && url.pathname === '/api/workflows/runs') {
      try {
        const allRuns = await engine.listRuns();
        const statusFilter = url.searchParams.get('status');
        const filtered = statusFilter ? allRuns.filter(r => r.status === statusFilter) : allRuns;
        const safeRuns = filtered.map(r => ({
          ...redactObject(r),
          id: r.runId,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(safeRuns));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // POST /api/workflows/runs - Start a new workflow run
    if (req.method === 'POST' && url.pathname === '/api/workflows/runs') {
      try {
        const rawBody = await readRequestBody(req);
        let body: any = {};
        try {
          body = JSON.parse(rawBody);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Malformed JSON payload' }));
          return;
        }

        let workflow: WorkflowDefinition | undefined;
        if (body.workflow && typeof body.workflow === 'object') {
          workflow = body.workflow as WorkflowDefinition;
        } else if (body.workflowId && typeof body.workflowId === 'string') {
          workflow = engine.getWorkflow(body.workflowId);
          if (!workflow) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: `Predefined workflow "${body.workflowId}" not found` }));
            return;
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Must specify "workflow" definition object or "workflowId"' }));
          return;
        }

        // Validate workflow structure
        if (!workflow.id || !Array.isArray(workflow.steps)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Workflow definition must include an "id" and "steps" array' }));
          return;
        }

        for (const step of workflow.steps) {
          if (!step.id || !step.bridge || !step.action) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: `Invalid step definition: each step must have id, bridge, and action` }));
            return;
          }
        }

        // Register and execute run
        engine.registerWorkflow(workflow);
        const run = engine.createRun(workflow);
        const executed = await engine.executeRun(workflow, run);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          run: {
            ...redactObject(executed),
            id: executed.runId,
          },
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // Specific Run detail route: GET /api/workflows/runs/:id
    const runMatch = url.pathname.match(/^\/api\/workflows\/runs\/([a-zA-Z0-9_-]+)$/);
    if (req.method === 'GET' && runMatch) {
      const runId = runMatch[1];
      const run = await engine.getRun(runId);
      if (!run) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Workflow run "${runId}" not found` }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        run: {
          ...redactObject(run),
          id: run.runId,
        },
        pendingApproval: run.pendingApproval ? redactObject(run.pendingApproval) : undefined,
      }));
      return;
    }

    // Inspect Approval Checkpoint: GET /api/workflows/runs/:id/approval
    const approvalMatch = url.pathname.match(/^\/api\/workflows\/runs\/([a-zA-Z0-9_-]+)\/approval$/);
    if (req.method === 'GET' && approvalMatch) {
      const runId = approvalMatch[1];
      const run = await engine.getRun(runId);
      if (!run) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Workflow run "${runId}" not found` }));
        return;
      }
      if (!run.pendingApproval) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `No active pending approval checkpoint for run "${runId}"` }));
        return;
      }

      const cp = run.pendingApproval;
      const consequences =
        cp.permissionLevel === 'publish'
          ? 'External Release / Publishing: This action will publish or deploy resources to an external service or public repository.'
          : cp.permissionLevel === 'destructive'
          ? 'Destructive Operation: This action will permanently modify or delete resources that cannot be undone.'
          : cp.permissionLevel === 'external-write'
          ? 'External Write: This action writes or modifies state on an external service or remote repository.'
          : 'Explicit user authorization required per security policy.';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        runId: run.runId,
        checkpoint: {
          ...redactObject(cp),
          inputs: redactObject(cp.inputs),
        },
        consequences: {
          permissionLevel: cp.permissionLevel,
          title: cp.permissionLevel === 'publish' ? 'External Release / Publishing' : 'Security Consent Required',
          description: consequences,
        },
      }));
      return;
    }

    // Approve Checkpoint: POST /api/workflows/runs/:id/approve
    const approveMatch = url.pathname.match(/^\/api\/workflows\/runs\/([a-zA-Z0-9_-]+)\/approve$/);
    if (req.method === 'POST' && approveMatch) {
      const runId = approveMatch[1];
      try {
        const body = JSON.parse(await readRequestBody(req));
        if (!body.approvalRequestId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'approvalRequestId is required' }));
          return;
        }
        if (!body.approvedBy || typeof body.approvedBy !== 'string' || !body.approvedBy.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'approvedBy is required and must be an explicit non-empty user identity' }));
          return;
        }

        const runBefore = await engine.getRun(runId);
        const checkpoint = runBefore?.pendingApproval;

        const approvedRun = await engine.approveStep(runId, body.approvalRequestId, {
          approvedBy: body.approvedBy.trim(),
          confirmed: true,
          reason: body.reason,
          expectedInputs: body.expectedInputs,
        });

        auditEntries.push({
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          runId,
          stepId: checkpoint?.stepId,
          provider: checkpoint?.provider || 'unknown',
          action: checkpoint?.action || 'unknown',
          status: 'approved',
          approvedBy: body.approvedBy.trim(),
          reason: body.reason,
          timestamp: new Date().toISOString(),
        });

        // Resume automatically if requested (default true)
        let finalRun = approvedRun;
        if (body.autoResume !== false) {
          finalRun = await engine.resumeRun(runId);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          run: {
            ...redactObject(finalRun),
            id: finalRun.runId,
          },
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // Reject Checkpoint: POST /api/workflows/runs/:id/reject
    const rejectMatch = url.pathname.match(/^\/api\/workflows\/runs\/([a-zA-Z0-9_-]+)\/reject$/);
    if (req.method === 'POST' && rejectMatch) {
      const runId = rejectMatch[1];
      try {
        const body = JSON.parse(await readRequestBody(req));
        if (!body.approvalRequestId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'approvalRequestId is required' }));
          return;
        }
        const operator = body.rejectedBy || body.approvedBy;
        if (!operator || typeof operator !== 'string' || !operator.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'rejectedBy or approvedBy is required and must be an explicit non-empty user identity' }));
          return;
        }

        const runBefore = await engine.getRun(runId);
        const checkpoint = runBefore?.pendingApproval;

        const rejectedRun = await engine.approveStep(runId, body.approvalRequestId, {
          approvedBy: operator.trim(),
          confirmed: false,
          reason: body.reason || 'Rejected by user',
        });

        auditEntries.push({
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          runId,
          stepId: checkpoint?.stepId,
          provider: checkpoint?.provider || 'unknown',
          action: checkpoint?.action || 'unknown',
          status: 'rejected',
          rejectedBy: operator.trim(),
          reason: body.reason || 'Rejected by user',
          timestamp: new Date().toISOString(),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          run: {
            ...redactObject(rejectedRun),
            id: rejectedRun.runId,
          },
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // Resume Run: POST /api/workflows/runs/:id/resume
    const resumeMatch = url.pathname.match(/^\/api\/workflows\/runs\/([a-zA-Z0-9_-]+)\/resume$/);
    if (req.method === 'POST' && resumeMatch) {
      const runId = resumeMatch[1];
      try {
        const resumedRun = await engine.resumeRun(runId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          run: {
            ...redactObject(resumedRun),
            id: resumedRun.runId,
          },
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // Reconcile Run: POST /api/workflows/runs/:id/reconcile
    const reconcileMatch = url.pathname.match(/^\/api\/workflows\/runs\/([a-zA-Z0-9_-]+)\/reconcile$/);
    if (req.method === 'POST' && reconcileMatch) {
      const runId = reconcileMatch[1];
      try {
        const bodyText = await readRequestBody(req);
        const body = JSON.parse(bodyText);
        const { decision, notes, outputOverride, resolvedBy } = body;
        if (!decision) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'decision is required (mark_completed, mark_failed, or retry_after_verification)' }));
          return;
        }

        const reconciledRun = await engine.reconcileRun(runId, decision, {
          notes,
          outputOverride,
          resolvedBy: resolvedBy || 'operator',
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          run: {
            ...redactObject(reconciledRun),
            id: reconciledRun.runId,
          },
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // Cancel Run: POST /api/workflows/runs/:id/cancel
    const cancelMatch = url.pathname.match(/^\/api\/workflows\/runs\/([a-zA-Z0-9_-]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const runId = cancelMatch[1];
      try {
        let reason = 'Cancelled via Manager dashboard';
        try {
          const body = JSON.parse(await readRequestBody(req));
          if (body.reason) reason = body.reason;
        } catch {
          // empty body ok
        }

        const cancelledRun = await engine.cancelRun(runId, reason);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          run: {
            ...redactObject(cancelledRun),
            id: cancelledRun.runId,
          },
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // GET /api/approvals - List global approval audit history
    if (req.method === 'GET' && url.pathname === '/api/approvals') {
      try {
        const approvalRecords = permissions.getApprovals();
        const permissionEntries: ManagerAuditEntry[] = approvalRecords.map(a => ({
          id: `perm-${a.approvedAt}-${a.action}`,
          provider: a.bridge,
          action: a.action,
          status: 'approved',
          approvedBy: a.approvedBy,
          reason: a.reason,
          timestamp: a.approvedAt,
        }));

        const allApprovals = [...auditEntries];
        for (const p of permissionEntries) {
          if (!allApprovals.some(e => e.action === p.action && e.approvedBy === p.approvedBy)) {
            allApprovals.push(p);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          approvals: allApprovals.map(a => redactObject(a)),
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // ─── Custom Bridge Builder Endpoints ─────────────────────────

    // POST /api/builder/analyze - Analyze prompt and recommend strategy (MCP-first)
    if (req.method === 'POST' && url.pathname === '/api/builder/analyze') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        if (!body.prompt || typeof body.prompt !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'prompt is required and must be a string' }));
          return;
        }
        const strategy = await builder.analyzeStrategy(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, strategy }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/builder/generate - Generate custom bridge into staging
    if (req.method === 'POST' && url.pathname === '/api/builder/generate') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        if (!body.prompt || typeof body.prompt !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'prompt is required and must be a string' }));
          return;
        }
        const staged = await builder.generateBridge(body);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, staged: redactObject(staged) }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // GET /api/builder/staged - List all staged bridges
    if (req.method === 'GET' && url.pathname === '/api/builder/staged') {
      try {
        const stagedList = await builder.listStagedBridges();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ staged: stagedList.map(s => redactObject(s)) }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // GET /api/builder/staged/:id - Get specific staged bridge
    const stagedGetMatch = url.pathname.match(/^\/api\/builder\/staged\/([a-zA-Z0-9_-]+)$/);
    if (req.method === 'GET' && stagedGetMatch) {
      const id = stagedGetMatch[1];
      try {
        const staged = await builder.getStagedBridge(id);
        if (!staged) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Staged bridge "${id}" not found` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, staged: redactObject(staged) }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/builder/staged/:id/validate - Run validation & static security checks
    const stagedValidateMatch = url.pathname.match(/^\/api\/builder\/staged\/([a-zA-Z0-9_-]+)\/validate$/);
    if (req.method === 'POST' && stagedValidateMatch) {
      const id = stagedValidateMatch[1];
      try {
        const staged = await builder.validateStagedBridge(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, staged: redactObject(staged) }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/builder/staged/:id/test - Run isolated tests in sandbox
    const stagedTestMatch = url.pathname.match(/^\/api\/builder\/staged\/([a-zA-Z0-9_-]+)\/test$/);
    if (req.method === 'POST' && stagedTestMatch) {
      const id = stagedTestMatch[1];
      try {
        const staged = await builder.testStagedBridge(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, staged: redactObject(staged) }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/builder/staged/:id/register - Operator review & production promotion
    const stagedRegisterMatch = url.pathname.match(/^\/api\/builder\/staged\/([a-zA-Z0-9_-]+)\/register$/);
    if (req.method === 'POST' && stagedRegisterMatch) {
      const id = stagedRegisterMatch[1];
      try {
        const body = JSON.parse(await readRequestBody(req));
        if (!body.approvedBy || typeof body.approvedBy !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'approvedBy operator identity is required to register a bridge' }));
          return;
        }
        const staged = await builder.registerBridge(id, body.approvedBy, body.reviewNotes);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, staged: redactObject(staged) }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // DELETE /api/builder/staged/:id - Delete staged bridge draft
    const stagedDeleteMatch = url.pathname.match(/^\/api\/builder\/staged\/([a-zA-Z0-9_-]+)$/);
    if (req.method === 'DELETE' && stagedDeleteMatch) {
      const id = stagedDeleteMatch[1];
      try {
        const deleted = await builder.deleteStagedBridge(id);
        if (!deleted) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Staged bridge "${id}" not found` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: `Staged bridge "${id}" deleted.` }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // ─── Static File Serving (Hardened against Traversal) ─────────


    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // Normalize path and prevent directory traversal
    const requestedFile = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const safePath = normalize(join(MANAGER_DIR, requestedFile));

    // Strict boundary enforcement: resolved path MUST be inside MANAGER_DIR
    if (!safePath.startsWith(MANAGER_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: Access outside manager directory is prohibited');
      return;
    }

    try {
      const content = await readFile(safePath);
      const ext = extname(safePath).toLowerCase();
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  });

  return server;
}

async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;
  const server = createManagerServer(port);

  server.listen(port, () => {
    console.log(`\n  ⚒️  AgentForge Manager`);
    console.log(`  ─────────────────────`);
    console.log(`  Dashboard:    http://localhost:${port}`);
    console.log(`  Health Check: http://localhost:${port}/api/status`);
    console.log(`  API Bridges:  http://localhost:${port}/api/bridges`);
    console.log(`  Press Ctrl+C to stop\n`);
  });
}

// Run main if this is the entry point
if (process.argv[1]?.endsWith('serve.ts') || process.argv[1]?.endsWith('serve.js')) {
  main().catch(console.error);
}
