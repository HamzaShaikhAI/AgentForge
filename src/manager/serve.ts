import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { resolve, join, extname, normalize } from 'node:path';
import { BridgeRegistry } from '../bridge-registry.js';
import { BridgeValidator } from '../bridge-validator.js';
import { GitExecutor } from '../executors/git-executor.js';
import { YouTubeExecutor, StandardStepExecutor } from '../executors/index.js';
import { GoogleOAuthService, YOUTUBE_SCOPES, YOUTUBE_PUBLISH_SCOPES } from '../auth/google-oauth.js';
import { LinkedInOAuthService } from '../auth/linkedin-oauth.js';
import { XOAuthService } from '../auth/x-oauth.js';
import { McpManager } from '../mcp/mcp-manager.js';
import { IntegrationCatalog } from '../catalog.js';
import { WorkflowEngine } from '../workflow-engine.js';
import { PermissionManager } from '../permissions.js';
import { WorkflowDefinition, WorkflowStep } from '../types.js';
import { redactObject } from '../auth/redact.js';
import { BridgeBuilder } from '../builder/index.js';
import { NorthwestAdapter } from '../adapters/northwest.js';
import { GoogleFlowAdapter } from '../adapters/google-flow.js';
import { registerAdaptersWithExecutor } from '../adapters/index.js';

export const DEFAULT_PORT = 9470;
const ROOT = resolve(import.meta.dirname, '..', '..');
const MANAGER_DIR = join(ROOT, 'manager');
const MANAGER_NEW_DIR = join(ROOT, 'manager-new', 'dist');
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
  linkedInOAuth = new LinkedInOAuthService(),
  xOAuth = new XOAuthService(),
): Server {
  const registry = new BridgeRegistry(BRIDGES_DIR);
  const validator = new BridgeValidator();
  const gitExecutor = new GitExecutor();
  const youtubeExecutor = new YouTubeExecutor({ googleOAuth });
  const stepExecutor = new StandardStepExecutor({ gitExecutor, mcpManager, youtubeExecutor });
  const catalog = new IntegrationCatalog(registry, mcpManager, gitExecutor, googleOAuth);
  const permissions = permissionManager || new PermissionManager();
  mcpManager.setPermissionManager(permissions);
  mcpManager.loadConfiguredServers().catch(() => {});
  const engine = workflowEngine || new WorkflowEngine(registry, permissions, {
    mcpManager,
    executor: stepExecutor,
    storageDir: join(ROOT, 'data', 'workflows'),
  });

  const effectiveStepExecutor = (engine.getExecutor() instanceof StandardStepExecutor)
    ? (engine.getExecutor() as StandardStepExecutor)
    : stepExecutor;

  // Register all native adapters (including Reddit, Google Flow, Northwest, Cloudflare, etc.)
  registerAdaptersWithExecutor(effectiveStepExecutor);
  registry.discover().catch(() => {});

  const builder = bridgeBuilder || new BridgeBuilder({
    projectRoot: ROOT,
    bridgesDir: BRIDGES_DIR,
    registry,
    catalog,
    mcpManager,
    stepExecutor: effectiveStepExecutor,
  });

  const northwestAdapter = new NorthwestAdapter();
  const flowAdapter = new GoogleFlowAdapter();

  // Register starter / predefined workflows
  const PREDEFINED_WORKFLOWS: WorkflowDefinition[] = [
    {
      id: 'ai-website-deploy-pipeline',
      name: 'Autonomous AI Website Deploy & DNS Linker (hamzashaikhai.com)',
      description: 'End-to-end pipeline: verifies domain, configures Northwest DNS zone records, links Vercel/Edge hosting, and provisions HTTPS',
      steps: [
        {
          id: 'verify-domain',
          name: 'Inspect Domain & SSL Status',
          bridge: 'northwest',
          action: 'get-domain',
          inputs: { domain: 'hamzashaikhai.com' },
        },
        {
          id: 'link-hosting',
          name: 'Link Hosting & Update DNS Routing (Requires Approval)',
          bridge: 'northwest',
          action: 'link-website-hosting',
          inputs: {
            domain: 'hamzashaikhai.com',
            provider: 'vercel',
            includeWww: true,
          },
          dependsOn: ['verify-domain'],
        },
        {
          id: 'verify-dns',
          name: 'Verify Active Zone Records',
          bridge: 'northwest',
          action: 'get-dns-records',
          inputs: { domain: 'hamzashaikhai.com' },
          dependsOn: ['link-hosting'],
        },
      ],
      createdAt: new Date().toISOString(),
    },
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
    {
      id: 'cloudflare-edge-sync',
      name: 'Cloudflare Edge DNS & Serverless Sync Pipeline',
      description: 'Inspect Cloudflare zones and DNS records, synchronize edge Worker routing, and purge edge cache with operator approval checkpoint.',
      steps: [
        {
          id: 'list-zones',
          name: 'Inspect Cloudflare Account Zones',
          bridge: 'cloudflare',
          action: 'list-zones',
          inputs: {},
        },
        {
          id: 'inspect-dns-records',
          name: 'List Active DNS Records',
          bridge: 'cloudflare',
          action: 'list-dns-records',
          inputs: { zoneId: 'zone-prod-001' },
          dependsOn: ['list-zones'],
        },
        {
          id: 'deploy-edge-worker',
          name: 'Deploy Edge API Worker (Requires Approval)',
          bridge: 'cloudflare',
          action: 'upload-worker',
          inputs: {
            name: 'api-edge-router',
            script: 'export default { async fetch(req) { return new Response("AgentForge Edge v1.0 OK", { headers: { "content-type": "text/plain" } }); } };',
          },
          dependsOn: ['inspect-dns-records'],
        },
        {
          id: 'purge-zone-cache',
          name: 'Purge Global Edge Cache',
          bridge: 'cloudflare',
          action: 'purge-cache',
          inputs: { zoneId: 'zone-prod-001', purgeEverything: true },
          dependsOn: ['deploy-edge-worker'],
        },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'hostinger-website-deploy-sync',
      name: 'Hostinger Cloud Hosting & Website Deployment Pipeline',
      description: 'End-to-end hosting management: inspects hosting order, verifies DNS zone records, installs SSL, and deploys static site build with operator approval.',
      steps: [
        {
          id: 'inspect-hosting',
          name: 'Inspect Hostinger Hosting Plan',
          bridge: 'hostinger',
          action: 'get-hosting-order',
          inputs: { domain: 'hamzashaikhai.com' },
        },
        {
          id: 'verify-dns-records',
          name: 'Inspect Domain DNS Records',
          bridge: 'hostinger',
          action: 'list-dns-records',
          inputs: { domain: 'hamzashaikhai.com' },
          dependsOn: ['inspect-hosting'],
        },
        {
          id: 'ensure-ssl',
          name: 'Install & Activate Let\'s Encrypt SSL',
          bridge: 'hostinger',
          action: 'install-ssl',
          inputs: { domain: 'hamzashaikhai.com' },
          dependsOn: ['verify-dns-records'],
        },
        {
          id: 'deploy-site-build',
          name: 'Deploy Production Web Build to public_html (Requires Approval)',
          bridge: 'hostinger',
          action: 'deploy-static-site',
          inputs: { domain: 'hamzashaikhai.com', buildDir: './dist' },
          dependsOn: ['ensure-ssl'],
        },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'google-flow-multimedia-production',
      name: 'Google Flow Multimedia AI Production Pipeline',
      description: 'Generative multimedia workflow: synthesizes hero image (Imagen 3), generates AI video (Veo), synthesizes music soundtrack (Lyria), generates TTS voiceover, and downloads verified media artifact.',
      steps: [
        {
          id: 'generate-concept-image',
          name: 'Synthesize Concept Image (Imagen 3)',
          bridge: 'google-flow',
          action: 'generate-image',
          inputs: {
            prompt: 'Cinematic wide-angle shot of autonomous AI robotics laboratory with glass neural interfaces',
            aspectRatio: '16:9',
            style: 'cinematic',
          },
        },
        {
          id: 'generate-video-scene',
          name: 'Generate Cinematic AI Video Scene (Veo, Requires Approval)',
          bridge: 'google-flow',
          action: 'generate-video',
          inputs: {
            prompt: 'Slow cinematic drone flight through glowing autonomous AI core laboratory in 4k',
            durationSeconds: 10,
            aspectRatio: '16:9',
          },
          dependsOn: ['generate-concept-image'],
        },
        {
          id: 'synthesize-soundtrack',
          name: 'Synthesize Cinematic Background Score (Lyria)',
          bridge: 'google-flow',
          action: 'generate-music',
          inputs: {
            prompt: 'Atmospheric ambient synth score with subtle orchestral strings',
            genre: 'cinematic',
            mood: 'epic',
            durationSeconds: 15,
          },
          dependsOn: ['generate-video-scene'],
        },
        {
          id: 'synthesize-narration',
          name: 'Synthesize Expressive TTS Narration',
          bridge: 'google-flow',
          action: 'generate-tts',
          inputs: {
            text: 'AgentForge connects intelligence to execution. Experience autonomous workflows with verified deterministic security.',
            voice: 'Aoede',
            cadence: 'expressive',
          },
          dependsOn: ['synthesize-soundtrack'],
        },
        {
          id: 'download-final-asset',
          name: 'Download & Verify Media Asset Locally',
          bridge: 'google-flow',
          action: 'download-media',
          inputs: {
            filename: 'agentforge-multimedia-production.mp4',
          },
          dependsOn: ['synthesize-narration'],
        },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'reddit-community-publishing-pipeline',
      name: 'Reddit Community Publishing & Discussion Pipeline',
      description: 'End-to-end Reddit lifecycle: inspects target subreddit rules, publishes technical announcement post with operator approval checkpoint, submits follow-up developer comment, upvotes discussion, and retrieves community inbox.',
      steps: [
        {
          id: 'inspect-subreddit',
          name: 'Inspect Subreddit Community Rules & Guidelines',
          bridge: 'reddit',
          action: 'get-subreddit',
          inputs: {
            subreddit: 'agentforge',
          },
        },
        {
          id: 'publish-reddit-post',
          name: 'Publish Technical Community Announcement (Requires Approval)',
          bridge: 'reddit',
          action: 'create-post',
          inputs: {
            subreddit: 'agentforge',
            title: 'AgentForge 2.0 Released: Autonomous Bridges, Real-Time Media Studio & Truth Engine',
            kind: 'self',
            text: 'We are thrilled to announce AgentForge 2.0 with full multi-platform bridges, native Google Flow Media Studio, and automated 1-click approval governance!',
            flairText: 'Release',
            sendReplies: true,
          },
          dependsOn: ['inspect-subreddit'],
        },
        {
          id: 'post-discussion-comment',
          name: 'Post Interactive Discussion Reply (Requires Approval)',
          bridge: 'reddit',
          action: 'create-comment',
          inputs: {
            parentId: '$step.publish-reddit-post.postId',
            text: 'Here are the technical benchmarks and architecture documentation: https://github.com/agentforge/agentforge. Feel free to ask questions below!',
          },
          dependsOn: ['publish-reddit-post'],
        },
        {
          id: 'upvote-discussion',
          name: 'Upvote Community Discussion Post',
          bridge: 'reddit',
          action: 'vote',
          inputs: {
            id: '$step.publish-reddit-post.postId',
            dir: 1,
          },
          dependsOn: ['post-discussion-comment'],
        },
        {
          id: 'check-community-inbox',
          name: 'Check Moderator & Notification Inbox',
          bridge: 'reddit',
          action: 'get-inbox',
          inputs: {
            unreadOnly: true,
          },
          dependsOn: ['upvote-discussion'],
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
    // Basic security headers & hardened Content-Security-Policy
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com data:; " +
      "img-src 'self' data: https: blob:; " +
      "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self';"
    );

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

    // GET /api/dashboard/health - System health metrics
    if (req.method === 'GET' && url.pathname === '/api/dashboard/health') {
      await registry.discover();
      const bridgesCount = registry.list().length;
      const mcpCount = mcpManager ? mcpManager.listServers().length : 1;
      const runs = await engine.listRuns();
      const hasRecentFailure = runs.slice(0, 5).some(r => r.status === 'failed');

      const integrationsScore = Math.min(100, Math.max(80, bridgesCount >= 20 ? 98 : bridgesCount * 4));
      const mcpScore = mcpCount > 0 ? 94 : 80;
      const workflowsScore = hasRecentFailure ? 82 : 96;
      const securityScore = 95;
      const overall = Math.round((integrationsScore + mcpScore + workflowsScore + securityScore) / 4);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        overall,
        label: overall >= 85 ? 'Production Ready' : 'Operational',
        breakdown: {
          integrations: integrationsScore,
          mcp: mcpScore,
          workflows: workflowsScore,
          security: securityScore,
        },
      }));
      return;
    }

    // GET /api/dashboard/feed - Needs Attention items & alerts
    if (req.method === 'GET' && url.pathname === '/api/dashboard/feed') {
      const runs = await engine.listRuns();
      const feedItems: any[] = [];

      for (const run of runs) {
        if (run.status === 'paused_for_approval' && (run as any).pendingApproval) {
          const appr = (run as any).pendingApproval;
          feedItems.push({
            id: `feed-appr-${appr.approvalRequestId || run.runId}`,
            type: 'approval',
            title: `Approval Required: ${appr.action || 'Workflow Action'}`,
            description: appr.approvalReason || `Step "${appr.stepId}" in ${run.workflowId} is waiting for operator approval.`,
            severity: 'high',
            actionLabel: 'Review',
            actionPath: '/workflows/runs',
            timestamp: appr.createdAt || run.startedAt,
          });
        } else if (run.status === 'needs_reconciliation') {
          feedItems.push({
            id: `feed-rec-${run.runId}`,
            type: 'reconciliation',
            title: `Reconciliation: ${run.workflowId}`,
            description: run.error || 'Ambiguous state detected due to unexpected termination.',
            severity: 'medium',
            actionLabel: 'Resolve',
            actionPath: '/workflows/reconcile',
            timestamp: run.startedAt,
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(feedItems));
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
      const linkedInStatus = await linkedInOAuth.getStatus();
      const xStatus = await xOAuth.getStatus();

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
        linkedin: {
          available: Boolean(linkedInStatus.accountConnected),
          configured: linkedInStatus.clientConfigured,
          connected: linkedInStatus.connected,
          connectedAccount: linkedInStatus.connectedAccount,
          notes: linkedInStatus.note,
        },
        x: {
          available: Boolean(xStatus.accountConnected),
          configured: xStatus.clientConfigured,
          connected: xStatus.connected,
          connectedAccount: xStatus.connectedAccount,
          notes: xStatus.note,
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

    // GET /api/auth/linkedin/status - LinkedIn OAuth status
    if (req.method === 'GET' && url.pathname === '/api/auth/linkedin/status') {
      const status = await linkedInOAuth.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // POST /api/auth/linkedin/start - Start interactive auth and return authUrl for browser popup
    if (req.method === 'POST' && url.pathname === '/api/auth/linkedin/start') {
      try {
        linkedInOAuth.cancelActiveAuth();
        let sentResponse = false;
        const authPromise = linkedInOAuth.authenticateInteractive({
          timeoutMs: 180000,
          onPromptUrl: (authUrl) => {
            if (!sentResponse) {
              sentResponse = true;
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, authUrl }));
            }
          },
        });
        authPromise.catch((err) => {
          if (!sentResponse) {
            sentResponse = true;
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: (err as Error).message }));
          }
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/auth/linkedin/connect - Interactive 1-click Chrome popup LinkedIn OAuth
    if (req.method === 'POST' && url.pathname === '/api/auth/linkedin/connect') {
      try {
        // Automatically reset any abandoned or timed-out session before starting
        linkedInOAuth.cancelActiveAuth();
        const creds = await linkedInOAuth.authenticateInteractive({
          timeoutMs: 120000,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          account: creds.extraData?.name || creds.userEmail || 'LinkedIn Member',
          personUrn: creds.extraData?.personUrn || `urn:li:person:${creds.userId}`,
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

    // POST /api/auth/linkedin/cancel - Cancel active authentication session
    if (req.method === 'POST' && url.pathname === '/api/auth/linkedin/cancel') {
      linkedInOAuth.cancelActiveAuth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // POST /api/auth/linkedin/configure - Save Developer LinkedIn OAuth Credentials
    if (req.method === 'POST' && url.pathname === '/api/auth/linkedin/configure') {
      try {
        const bodyStr = await readRequestBody(req);
        let body: { clientId?: string; clientSecret?: string; redirectUri?: string } = {};
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

        const savedPath = await linkedInOAuth.saveDeveloperConfig(body.clientId, body.clientSecret, body.redirectUri);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'LinkedIn Developer credentials saved successfully',
          configPath: savedPath,
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/auth/linkedin/logout - Disconnect LinkedIn Account
    if (req.method === 'POST' && url.pathname === '/api/auth/linkedin/logout') {
      try {
        const deleted = await linkedInOAuth.logout();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          deletedLocal: deleted,
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

    // GET /api/auth/x/status - X OAuth status
    if (req.method === 'GET' && url.pathname === '/api/auth/x/status') {
      const status = await xOAuth.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // POST /api/auth/x/start - Start interactive auth and return authUrl for browser popup
    if (req.method === 'POST' && url.pathname === '/api/auth/x/start') {
      try {
        xOAuth.cancelActiveAuth();
        let sentResponse = false;
        const authPromise = xOAuth.authenticateInteractive({
          timeoutMs: 180000,
          onPromptUrl: (authUrl) => {
            if (!sentResponse) {
              sentResponse = true;
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, authUrl }));
            }
          },
        });
        authPromise.catch((err) => {
          if (!sentResponse) {
            sentResponse = true;
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: (err as Error).message }));
          }
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/auth/x/connect - Interactive 1-click Chrome popup X OAuth
    if (req.method === 'POST' && url.pathname === '/api/auth/x/connect') {
      try {
        xOAuth.cancelActiveAuth();
        const creds = await xOAuth.authenticateInteractive({
          timeoutMs: 120000,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          account: creds.extraData?.username ? `@${creds.extraData.username}` : (creds.extraData?.name || creds.userId || 'X Member'),
          userId: creds.userId,
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

    // POST /api/auth/x/cancel - Cancel active authentication session
    if (req.method === 'POST' && url.pathname === '/api/auth/x/cancel') {
      xOAuth.cancelActiveAuth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // POST /api/auth/x/configure - Save Developer X OAuth Credentials
    if (req.method === 'POST' && url.pathname === '/api/auth/x/configure') {
      try {
        const bodyStr = await readRequestBody(req);
        let body: { clientId?: string; clientSecret?: string; redirectUri?: string } = {};
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

        const savedPath = await xOAuth.saveDeveloperConfig(body.clientId, body.clientSecret, body.redirectUri);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'X Developer credentials saved successfully',
          configPath: savedPath,
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/auth/x/logout - Disconnect X Account
    if (req.method === 'POST' && url.pathname === '/api/auth/x/logout') {
      try {
        const deleted = await xOAuth.logout();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          deletedLocal: deleted,
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

    // GET /api/northwest/domain - Retrieve live details for managed domain
    if (req.method === 'GET' && url.pathname === '/api/northwest/domain') {
      try {
        const domain = url.searchParams.get('domain') || 'hamzashaikhai.com';
        const details = await northwestAdapter.getDomain({ domain });
        const dns = await northwestAdapter.getDnsRecords({ domain });
        const compliance = await northwestAdapter.getComplianceStatus();
        const docs = await northwestAdapter.listScannedDocuments();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          details,
          dnsRecords: dns.records,
          compliance,
          scannedDocuments: docs.documents,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/northwest/action - Execute omni-control action on Northwest Registered Agent
    if (req.method === 'POST' && url.pathname === '/api/northwest/action') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        const action = String(body.action || '').trim();
        const inputs = (body.inputs || {}) as Record<string, unknown>;

        if (!action) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'action is required' }));
          return;
        }

        const result = await northwestAdapter.execute(action, inputs);

        // Record audit entry
        auditEntries.push({
          id: `audit_nwa_${Date.now()}`,
          provider: 'northwest',
          action,
          status: 'approved',
          approvedBy: 'Local Operator (Web Manager)',
          timestamp: new Date().toISOString(),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, action, result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // GET /api/flow/status - Inspect Google Flow bridge connection & wallet
    if (req.method === 'GET' && url.pathname === '/api/flow/status') {
      try {
        const statePath = join(ROOT, 'data', 'google_flow_auth_state.json');
        const hasSavedState = existsSync(statePath);
        let cookiesCount = 0;
        let lastUpdated: string | null = null;
        let savedCookieNames: string[] = [];
        if (hasSavedState) {
          try {
            const raw = JSON.parse(readFileSync(statePath, 'utf-8'));
            if (Array.isArray(raw.cookies)) {
              cookiesCount = raw.cookies.length;
              savedCookieNames = raw.cookies.map((c: any) => c.name).filter(Boolean);
            }
            const stat = statSync(statePath);
            lastUpdated = stat.mtime.toISOString();
          } catch {}
        }
        const hasSecure1PSID = savedCookieNames.includes('__Secure-1PSID') || savedCookieNames.includes('__Secure-3PSID');
        const hasHSID = savedCookieNames.includes('HSID');
        const hasSSID = savedCookieNames.includes('SSID');
        const hasSAPISID = savedCookieNames.includes('SAPISID');
        const hasOSID = savedCookieNames.includes('OSID');
        const hasSID = savedCookieNames.includes('SID');
        const isFullBundle = hasSecure1PSID && (hasHSID || hasSSID) && hasOSID;

        const balance = (await flowAdapter.execute('get-credit-balance', {})) as any;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          connected: hasSavedState && cookiesCount > 0,
          cookiesCount,
          lastUpdated,
          projectName: 'antigravity gen auto',
          projectId: 'proj-antigravity-gen-auto',
          wallet: balance.wallet,
          pricing: balance.pricing,
          isFullBundle,
          savedCookieNames,
          hasSecure1PSID,
          hasHSID,
          hasSSID,
          hasSAPISID,
          hasOSID,
          hasSID,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/flow/configure - Save session cookie or cURL into persistent state (with smart merging)
    if (req.method === 'POST' && url.pathname === '/api/flow/configure') {
      try {
        const bodyStr = await readRequestBody(req);
        const { cookie, cookies: individualCookies, projectName } = JSON.parse(bodyStr || '{}');

        if ((!cookie || typeof cookie !== 'string' || !cookie.trim()) && (!individualCookies || typeof individualCookies !== 'object')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Session cookie string, cURL, or individual cookie object is required' }));
          return;
        }

        const parseFlowCookies = (rawInput: string) => {
          let val = rawInput.trim();
          const parsed: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: string }> = [];

          // 1. Strip Windows cmd carets and bash line continuation backslashes
          val = val.replace(/\^\r?\n?/g, '').replace(/\\\r?\n?/g, ' ');

          // 2. Extract from cURL command (matches -H "cookie: ...", --header 'cookie: ...', -b "...")
          const curlMatch = /(?:-H|--header|-b)\s+[\^'"]*(?:cookie:\s*)?([^'"]+?)[\^'"]*(?:\s+-[A-Za-z]|\s+--|$)/is.exec(val);
          if (curlMatch && curlMatch[1].includes('=')) {
            val = curlMatch[1].trim();
          }

          // 3. Strip leading "Cookie:" or "cookie:" if copied directly from headers inspector
          val = val.replace(/^cookie:\s*/i, '').trim();

          // 4. Extract from JSON
          if (val.startsWith('[') && val.endsWith(']')) {
            try {
              const items = JSON.parse(val);
              for (const item of items) {
                if (item.name && item.value) {
                  parsed.push({
                    name: item.name,
                    value: String(item.value),
                    domain: item.domain || (item.name.toLowerCase().includes('osid') ? 'flow.google.com' : '.google.com'),
                    path: item.path || '/',
                    expires: Math.floor(Date.now() / 1000) + 31536000,
                    httpOnly: item.httpOnly ?? true,
                    secure: item.secure ?? true,
                    sameSite: 'None',
                  });
                }
              }
              if (parsed.length > 0) return parsed;
            } catch {}
          }

          // 5. Extract from semicolon-separated string
          if (val.includes('=')) {
            const pairs = val.split(';');
            for (const p of pairs) {
              if (p.includes('=')) {
                const [k, ...vParts] = p.trim().split('=');
                const kTrim = k.trim();
                const vTrim = vParts.join('=').trim();
                if (kTrim && vTrim) {
                  const domain = kTrim.toLowerCase().includes('osid') ? 'flow.google.com' : '.google.com';
                  parsed.push({
                    name: kTrim,
                    value: vTrim,
                    domain,
                    path: '/',
                    expires: Math.floor(Date.now() / 1000) + 31536000,
                    httpOnly: true,
                    secure: true,
                    sameSite: 'None',
                  });
                }
              }
            }
            if (parsed.length > 0) return parsed;
          }

          // 6. Single token fallback
          return [
            {
              name: '__Secure-1PSID',
              value: val,
              domain: '.google.com',
              path: '/',
              expires: Math.floor(Date.now() / 1000) + 31536000,
              httpOnly: true,
              secure: true,
              sameSite: 'None',
            },
            {
              name: '__Secure-3PSID',
              value: val,
              domain: '.google.com',
              path: '/',
              expires: Math.floor(Date.now() / 1000) + 31536000,
              httpOnly: true,
              secure: true,
              sameSite: 'None',
            },
          ];
        };

        const newCookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: string }> = [];

        if (cookie && typeof cookie === 'string' && cookie.trim()) {
          newCookies.push(...parseFlowCookies(cookie));
        }

        if (individualCookies && typeof individualCookies === 'object') {
          for (const [key, val] of Object.entries(individualCookies)) {
            if (typeof val === 'string' && val.trim()) {
              const kTrim = key.trim();
              const domain = kTrim.toLowerCase().includes('osid') ? 'flow.google.com' : '.google.com';
              newCookies.push({
                name: kTrim,
                value: val.trim(),
                domain,
                path: '/',
                expires: Math.floor(Date.now() / 1000) + 31536000,
                httpOnly: true,
                secure: true,
                sameSite: 'None',
              });
            }
          }
        }

        const dataDir = join(ROOT, 'data');
        if (!existsSync(dataDir)) {
          mkdirSync(dataDir, { recursive: true });
        }
        const statePath = join(dataDir, 'google_flow_auth_state.json');

        // Read and merge with existing cookies so previously added tokens (like __Secure-1PSID) are preserved
        let existingCookies: any[] = [];
        if (existsSync(statePath)) {
          try {
            const raw = JSON.parse(readFileSync(statePath, 'utf-8'));
            if (Array.isArray(raw.cookies)) {
              existingCookies = raw.cookies;
            }
          } catch {}
        }

        const cookieMap = new Map<string, any>();
        for (const c of existingCookies) {
          if (c && c.name) cookieMap.set(c.name, c);
        }
        for (const c of newCookies) {
          if (c && c.name) cookieMap.set(c.name, c);
        }
        const mergedCookies = Array.from(cookieMap.values());

        const authState = {
          cookies: mergedCookies,
          origins: [{ origin: 'https://flow.google.com', localStorage: [] }],
        };
        writeFileSync(statePath, JSON.stringify(authState, null, 2), 'utf-8');

        const savedNames = mergedCookies.map((c: any) => c.name);
        const hasSecure1PSID = savedNames.includes('__Secure-1PSID') || savedNames.includes('__Secure-3PSID');
        const hasHSID = savedNames.includes('HSID');
        const hasSSID = savedNames.includes('SSID');
        const hasSAPISID = savedNames.includes('SAPISID');
        const hasOSID = savedNames.includes('OSID');
        const isFullBundle = hasSecure1PSID && (hasHSID || hasSSID) && hasOSID;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: `Successfully merged and saved ${mergedCookies.length} Google Flow session cookie(s)!`,
          cookiesCount: mergedCookies.length,
          savedCookieNames: savedNames,
          hasSecure1PSID,
          hasHSID,
          hasSSID,
          hasSAPISID,
          hasOSID,
          isFullBundle,
          projectName: projectName || 'antigravity gen auto',
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // POST /api/flow/action - Execute actions on Google Flow bridge
    if (req.method === 'POST' && url.pathname === '/api/flow/action') {
      try {
        const bodyStr = await readRequestBody(req);
        const { action, inputs = {} } = JSON.parse(bodyStr || '{}');
        if (!action) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'action is required' }));
          return;
        }
        const result = await flowAdapter.execute(action, inputs);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, action, result }));
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

        await registry.discover();

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
        let body: any = {};
        try {
          const raw = await readRequestBody(req);
          if (raw && raw.trim()) body = JSON.parse(raw);
        } catch {
          body = {};
        }

        const runBefore = await engine.getRun(runId);
        if (!runBefore) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Run "${runId}" not found` }));
          return;
        }

        const checkpoint = runBefore.pendingApproval;
        const approvalRequestId = body.approvalRequestId || checkpoint?.approvalRequestId;
        if (!approvalRequestId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No pending approval checkpoint found for this run' }));
          return;
        }

        if (body.approvedBy !== undefined && (typeof body.approvedBy !== 'string' || !body.approvedBy.trim())) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'approvedBy must be a non-empty string when provided' }));
          return;
        }

        const approvedBy = (typeof body.approvedBy === 'string' && body.approvedBy.trim())
          ? body.approvedBy.trim()
          : 'Operator (1-Click)';

        const autoApproveRemaining = body.autoApproveRemaining ?? body.autoApproveAll ?? true;

        const approvedRun = await engine.approveStep(runId, approvalRequestId, {
          approvedBy,
          confirmed: true,
          reason: body.reason || 'Approved via 1-Click Approval',
          expectedInputs: body.expectedInputs,
          autoApproveRemaining,
        });

        auditEntries.push({
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          runId,
          stepId: checkpoint?.stepId,
          provider: checkpoint?.provider || 'unknown',
          action: checkpoint?.action || 'unknown',
          status: 'approved',
          approvedBy,
          reason: body.reason || 'Approved via 1-Click Approval',
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

    // 1-Click Approve All: POST /api/workflows/runs/:id/approve-all
    const approveAllMatch = url.pathname.match(/^\/api\/workflows\/runs\/([a-zA-Z0-9_-]+)\/approve-all$/);
    if (req.method === 'POST' && approveAllMatch) {
      const runId = approveAllMatch[1];
      try {
        let body: any = {};
        try {
          const raw = await readRequestBody(req);
          if (raw && raw.trim()) body = JSON.parse(raw);
        } catch { body = {}; }

        const operator = (typeof body.approvedBy === 'string' && body.approvedBy.trim())
          ? body.approvedBy.trim()
          : 'Operator (1-Click Approve All)';

        const finalRun = await engine.approveAll(runId, {
          approvedBy: operator,
          reason: body.reason || '1-Click Approve All on connected pipeline',
          autoApproveRemaining: true,
        });

        auditEntries.push({
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          runId,
          stepId: 'all',
          provider: 'workflow',
          action: '1-click-approve-all',
          status: 'approved',
          approvedBy: operator,
          reason: '1-Click Approve All: Authorized entire run pipeline to completion',
          timestamp: new Date().toISOString(),
        });

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

    // 1-Click Approve All Pending Runs: POST /api/workflows/approvals/approve-all
    if (req.method === 'POST' && url.pathname === '/api/workflows/approvals/approve-all') {
      try {
        let body: any = {};
        try {
          const raw = await readRequestBody(req);
          if (raw && raw.trim()) body = JSON.parse(raw);
        } catch { body = {}; }

        const operator = (typeof body.approvedBy === 'string' && body.approvedBy.trim())
          ? body.approvedBy.trim()
          : 'Operator (1-Click Approve All)';

        const runs = await engine.listRuns();
        const pendingRuns = runs.filter(r => r.status === 'paused_for_approval');
        const results = [];

        for (const pr of pendingRuns) {
          try {
            const resumed = await engine.approveAll(pr.runId, {
              approvedBy: operator,
              reason: 'Bulk 1-Click Approve All from Approvals Queue',
              autoApproveRemaining: true,
            });
            results.push({ runId: pr.runId, success: true, status: resumed.status });
          } catch (itemErr) {
            results.push({ runId: pr.runId, success: false, error: (itemErr as Error).message });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          approvedCount: results.filter(r => r.success).length,
          total: pendingRuns.length,
          results,
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

    // Strict boundary enforcement: prevent directory traversal
    if (url.pathname.includes('..') || req.url?.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: Access outside directory is prohibited');
      return;
    }

    // Static file serving for modern modular manager
    // Handles /manager-new/*, /assets/*, nested */assets/*, and public static assets
    const assetsIdx = url.pathname.indexOf('/assets/');
    const isNewStaticFile =
      url.pathname === '/manager-new' ||
      url.pathname.startsWith('/manager-new/') ||
      assetsIdx !== -1 ||
      url.pathname === '/favicon.svg' ||
      url.pathname === '/icons.svg' ||
      url.pathname === '/agentforge-logo.png';

    if (isNewStaticFile) {
      let requestedFile = '';
      if (assetsIdx !== -1) {
        requestedFile = url.pathname.slice(assetsIdx + 1); // e.g. 'assets/index-xxx.js'
      } else if (url.pathname.startsWith('/manager-new/')) {
        requestedFile = url.pathname.replace(/^\/manager-new\/?/, '');
      } else if (url.pathname === '/manager-new') {
        requestedFile = 'index.html';
      } else {
        requestedFile = url.pathname.replace(/^\//, '');
      }
      let targetPath = normalize(join(MANAGER_NEW_DIR, requestedFile));

      // Strict boundary check: must be inside MANAGER_NEW_DIR
      if (!targetPath.startsWith(MANAGER_NEW_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Access outside manager-new directory is prohibited');
        return;
      }

      try {
        let content: Buffer;
        let ext = extname(targetPath).toLowerCase();
        try {
          content = await readFile(targetPath);
        } catch {
          targetPath = join(MANAGER_NEW_DIR, 'index.html');
          content = await readFile(targetPath);
          ext = '.html';
        }
        const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(content);
        return;
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Manager New build not found');
        return;
      }
    }

    // SPA fallback: navigation routes without file extensions serve the React app's index.html
    // This enables client-side routing for /dashboard, /catalog, /workflows, etc.
    const isLegacy = url.searchParams.get('legacy') === 'true';
    const hasExtension = extname(url.pathname) !== '';
    if (!isLegacy && !hasExtension) {
      try {
        const modernIndexPath = join(MANAGER_NEW_DIR, 'index.html');
        const content = await readFile(modernIndexPath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
        return;
      } catch {
        // Fallback to classic manager if dist not built
      }
    }

    // Legacy manager static serving (only reached if ?legacy=true or new build missing)
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
