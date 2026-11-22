import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  LinkedInAdapter,
  LINKEDIN_DEFAULT_VERSION,
  MAX_COMMENTARY_LENGTH,
} from './linkedin.js';
import { createBuiltinAdapters } from './index.js';
import { BridgeValidator } from '../bridge-validator.js';
import { BridgeRegistry } from '../bridge-registry.js';
import { PermissionManager } from '../permissions.js';
import { StandardStepExecutor } from '../executors/index.js';
import { WorkflowEngine } from '../workflow-engine.js';
import { AgentForgeMcpServer } from '../mcp-server.js';
import { BridgeManifest, WorkflowDefinition } from '../types.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MANIFEST_PATH = join(ROOT, 'bridges', 'linkedin', 'bridge.json');

describe('LinkedIn Bridge & Adapter (Schema v1.0, REST API, Security & Approvals)', () => {
  let tempDir: string;
  let originalToken: string | undefined;
  let originalPersonUrn: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-linkedin-test-'));
    originalToken = process.env.LINKEDIN_ACCESS_TOKEN;
    originalPersonUrn = process.env.LINKEDIN_PERSON_URN;
    process.env.LINKEDIN_ACCESS_TOKEN = 'AQX_mock_linkedin_secret_token_987654321';
    process.env.LINKEDIN_PERSON_URN = 'urn:li:person:ABC123xyz';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalToken === undefined) {
      delete process.env.LINKEDIN_ACCESS_TOKEN;
    } else {
      process.env.LINKEDIN_ACCESS_TOKEN = originalToken;
    }
    if (originalPersonUrn === undefined) {
      delete process.env.LINKEDIN_PERSON_URN;
    } else {
      process.env.LINKEDIN_PERSON_URN = originalPersonUrn;
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  describe('Manifest & Schema v1.0 Validation', () => {
    it('passes BridgeValidator.validate() and validateJSON() with 0 errors and 0 warnings', () => {
      const rawJson = readFileSync(MANIFEST_PATH, 'utf-8');
      const validator = new BridgeValidator();
      const jsonResult = validator.validateJSON(rawJson);

      expect(jsonResult.valid).toBe(true);
      expect(jsonResult.errors).toEqual([]);
      expect(jsonResult.warnings).toEqual([]);
      expect(jsonResult.manifest?.name).toBe('linkedin');
      expect(jsonResult.manifest?.displayName).toBe('LinkedIn');
      expect(jsonResult.manifest?.category).toBe('social-media');

      const objResult = validator.validate(jsonResult.manifest);
      expect(objResult.valid).toBe(true);
      expect(objResult.errors).toEqual([]);

      // Env-var based auth only
      expect(jsonResult.manifest?.auth).toHaveLength(2);
      for (const authReq of jsonResult.manifest!.auth) {
        expect(authReq.type).toBe('env-var');
        expect(authReq.required).toBe(true);
      }
      expect(jsonResult.manifest!.auth.map(a => a.envVar)).toEqual([
        'LINKEDIN_ACCESS_TOKEN',
        'LINKEDIN_PERSON_URN',
      ]);

      // Capability permission tiers
      const caps = Object.fromEntries(
        jsonResult.manifest!.capabilities.map(c => [c.action, c]),
      );
      expect(caps['profile-me'].permissionLevel).toBe('read');
      expect(caps['profile-me'].sideEffects).toBe(false);
      expect(caps['draft-post'].permissionLevel).toBe('local-write');
      expect(caps['draft-post'].sideEffects).toBe(true);
      expect(caps['upload-image'].permissionLevel).toBe('external-write');
      expect(caps['upload-image'].sideEffects).toBe(true);
      expect(caps['publish-post'].permissionLevel).toBe('publish');
      expect(caps['publish-post'].sideEffects).toBe(true);
    });

    it('discovers linkedin bridge via BridgeRegistry and validates via MCP agentforge_validate_manifest', async () => {
      const registry = new BridgeRegistry(join(ROOT, 'bridges'));
      const discovered = await registry.discover();
      expect(discovered.errors).toEqual([]);
      expect(discovered.loaded).toContain('linkedin');

      const rawJson = readFileSync(MANIFEST_PATH, 'utf-8');
      const server = new AgentForgeMcpServer(join(ROOT, 'bridges'));
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'agentforge_validate_manifest',
          arguments: { manifestJson: rawJson },
        },
      });

      const content = (res?.result as { content: Array<{ text: string }> }).content;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.valid).toBe(true);
      expect(parsed.errors).toEqual([]);
    });

    it('registers LinkedInAdapter in createBuiltinAdapters()', () => {
      const adapters = createBuiltinAdapters();
      const li = adapters.find(a => a.name === 'linkedin');
      expect(li).toBeDefined();
      expect(li?.category).toBe('social-media');
      expect(li?.getActions().map(a => a.action)).toEqual([
        'profile-me',
        'draft-post',
        'upload-image',
        'publish-post',
      ]);
    });
  });

  describe('Identity & Local Drafting (profile-me & draft-post)', () => {
    it('fetches authenticated member identity via /v2/userinfo with Bearer token', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            sub: 'ABC123xyz',
            name: 'Ada Lovelace',
            given_name: 'Ada',
            family_name: 'Lovelace',
            email: 'ada@example.com',
            picture: 'https://media.licdn.com/avatar.jpg',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new LinkedInAdapter({ allowedBaseDir: tempDir, retryDelayMs: 0 });
      const result = (await adapter.execute('profile-me', {})) as Record<string, unknown>;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.linkedin.com/v2/userinfo');
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer AQX_mock_linkedin_secret_token_987654321',
      );
      expect(result.sub).toBe('ABC123xyz');
      expect(result.personUrn).toBe('urn:li:person:ABC123xyz');
      expect(result.name).toBe('Ada Lovelace');
      expect(result.verified).toBe(true);
      expect(result.httpStatus).toBe(200);
    });

    it('draft-post validates commentary, URL, and poll inputs and saves local preview JSON', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new LinkedInAdapter({ allowedBaseDir: tempDir });
      const draftPath = join(tempDir, 'preview.json');

      const draft = (await adapter.execute('draft-post', {
        commentary: 'Shipping AgentForge LinkedIn Bridge v1.0!',
        articleUrl: 'https://github.com/HamzaShaikhAI/AgentForge',
        articleTitle: 'AgentForge on GitHub',
        visibility: 'PUBLIC',
        outputPath: draftPath,
      })) as Record<string, any>;

      expect(mockFetch).not.toHaveBeenCalled();
      expect(draft.saved).toBe(true);
      expect(draft.draftPath).toBe(draftPath);
      expect(draft.characterCount).toBe('Shipping AgentForge LinkedIn Bridge v1.0!'.length);
      expect(draft.payload.content.article.source).toBe('https://github.com/HamzaShaikhAI/AgentForge');

      const savedRaw = JSON.parse(await readFile(draftPath, 'utf-8'));
      expect(savedRaw.preview.attachmentType).toBe('article');
    });

    it('rejects commentary > 3000 chars and invalid or loopback URLs', async () => {
      const adapter = new LinkedInAdapter({ allowedBaseDir: tempDir });

      await expect(
        adapter.execute('draft-post', {
          commentary: 'x'.repeat(MAX_COMMENTARY_LENGTH + 1),
        }),
      ).rejects.toThrow('exceeds LinkedIn maximum length');

      await expect(
        adapter.execute('draft-post', {
          commentary: 'Bad URL test',
          articleUrl: 'http://127.0.0.1:8080/internal-admin',
        }),
      ).rejects.toThrow('private/loopback');

      await expect(
        adapter.execute('draft-post', {
          commentary: 'Bad protocol test',
          articleUrl: 'javascript:alert(1)',
        }),
      ).rejects.toThrow('not allowed');
    });
  });

  describe('Image Upload & Post Publishing (upload-image & publish-post)', () => {
    it('executes upload-image (initializeUpload + binary PUT) and feeds urn:li:image into publish-post', async () => {
      const imgPath = join(tempDir, 'launch-banner.png');
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
      writeFileSync(imgPath, pngBytes);

      const mockFetch = vi
        .fn()
        // 1. initializeUpload
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              value: {
                uploadUrl: 'https://www.linkedin.com/dms-uploads/sp/v2/D4D10AQ/uploaded-image/0?ca=secret_sig',
                image: 'urn:li:image:D4D10AQImageAsset99',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        // 2. Binary PUT
        .mockResolvedValueOnce(new Response(null, { status: 201 }))
        // 3. POST /rest/posts
        .mockResolvedValueOnce(
          new Response(null, {
            status: 201,
            headers: {
              'x-restli-id': 'urn:li:share:7180000123456789',
            },
          }),
        );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new LinkedInAdapter({ allowedBaseDir: tempDir, retryDelayMs: 0 });

      const uploadRes = (await adapter.execute('upload-image', {
        filePath: imgPath,
      })) as Record<string, unknown>;

      expect(uploadRes.success).toBe(true);
      expect(uploadRes.imageUrn).toBe('urn:li:image:D4D10AQImageAsset99');
      expect(uploadRes.mimeType).toBe('image/png');
      expect(uploadRes.bytesUploaded).toBe(pngBytes.length);
      expect(uploadRes.httpStatus).toBe(201);
      // Verify binary PUT call
      const [putUrl, putOpts] = mockFetch.mock.calls[1];
      expect(putUrl).toContain('https://www.linkedin.com/dms-uploads/');
      expect(putOpts?.method).toBe('PUT');
      expect((putOpts?.headers as Record<string, string>)['Content-Type']).toBe('image/png');
      expect(Buffer.isBuffer(putOpts?.body)).toBe(true);

      // Publish image post referencing uploaded imageUrn
      const publishRes = (await adapter.execute('publish-post', {
        commentary: 'Announcing AgentForge LinkedIn Bridge with image attachment!',
        imageUrn: uploadRes.imageUrn,
        imageAltText: 'AgentForge architecture diagram',
        visibility: 'PUBLIC',
      })) as Record<string, unknown>;

      expect(publishRes.published).toBe(true);
      expect(publishRes.postUrn).toBe('urn:li:share:7180000123456789');
      expect(publishRes.postUrl).toContain('urn%3Ali%3Ashare%3A7180000123456789');
      expect(publishRes.httpStatus).toBe(201);
      expect(typeof publishRes.timestamp).toBe('string');

      const [postUrl, postOpts] = mockFetch.mock.calls[2];
      expect(postUrl).toBe('https://api.linkedin.com/rest/posts');
      expect(postOpts?.method).toBe('POST');
      const postHeaders = postOpts?.headers as Record<string, string>;
      expect(postHeaders.Authorization).toBe('Bearer AQX_mock_linkedin_secret_token_987654321');
      expect(postHeaders['LinkedIn-Version']).toBe(LINKEDIN_DEFAULT_VERSION);
      expect(postHeaders['X-Restli-Protocol-Version']).toBe('2.0.0');

      const sentPayload = JSON.parse(String(postOpts?.body));
      expect(sentPayload).toEqual({
        author: 'urn:li:person:ABC123xyz',
        commentary: 'Announcing AgentForge LinkedIn Bridge with image attachment!',
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
        content: {
          media: {
            id: 'urn:li:image:D4D10AQImageAsset99',
            altText: 'AgentForge architecture diagram',
          },
        },
      });
    });

    it('uploads .gif animated visuals with image/gif MIME type', async () => {
      const gifPath = join(tempDir, 'gemini-swarm.gif');
      const gifBytes = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;');
      writeFileSync(gifPath, gifBytes);

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              value: {
                uploadUrl: 'https://www.linkedin.com/dms-uploads/sp/v2/gif/uploaded-image/0?ca=sig',
                image: 'urn:li:image:D4D10AQGifAsset42',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(new Response(null, { status: 201 }));
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new LinkedInAdapter({ allowedBaseDir: tempDir, retryDelayMs: 0 });

      const uploadRes = (await adapter.execute('upload-image', {
        filePath: gifPath,
      })) as Record<string, unknown>;

      expect(uploadRes.success).toBe(true);
      expect(uploadRes.imageUrn).toBe('urn:li:image:D4D10AQGifAsset42');
      expect(uploadRes.mimeType).toBe('image/gif');
      expect(uploadRes.bytesUploaded).toBe(gifBytes.length);
      expect(mockFetch.mock.calls[1][1]?.headers?.['Content-Type']).toBe('image/gif');
    });

    it('formats link-card and poll payloads accurately in publish-post', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:ugcPost:111' } }),
        )
        .mockResolvedValueOnce(
          new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:ugcPost:222' } }),
        );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new LinkedInAdapter({ retryDelayMs: 0 });

      await adapter.execute('publish-post', {
        commentary: 'Read the release notes',
        articleUrl: 'https://agentforge.dev/v1',
        articleTitle: 'AgentForge V1',
        articleDescription: 'Local-first workflow harness',
      });
      const linkBody = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
      expect(linkBody.content).toEqual({
        article: {
          source: 'https://agentforge.dev/v1',
          title: 'AgentForge V1',
          description: 'Local-first workflow harness',
        },
      });

      await adapter.execute('publish-post', {
        commentary: 'Quick community poll',
        poll: {
          question: 'Which bridge should we build next?',
          options: ['GitHub Actions', 'Slack Threads'],
          duration: 'THREE_DAYS',
        },
      });
      const pollBody = JSON.parse(String(mockFetch.mock.calls[1][1]?.body));
      expect(pollBody.content).toEqual({
        poll: {
          question: 'Which bridge should we build next?',
          options: [{ text: 'GitHub Actions' }, { text: 'Slack Threads' }],
          settings: { duration: 'THREE_DAYS' },
        },
      });
    });

    it('enforces safe file path checks for local image uploads', async () => {
      const adapter = new LinkedInAdapter({ allowedBaseDir: tempDir });

      // Outside allowedBaseDir traversal
      await expect(
        adapter.execute('upload-image', { filePath: join(tempDir, '..', 'outside.png') }),
      ).rejects.toThrow('Security Violation');

      // Disallowed extension
      const badExtPath = join(tempDir, 'payload.svg');
      writeFileSync(badExtPath, '<svg></svg>');
      await expect(
        adapter.execute('upload-image', { filePath: badExtPath }),
      ).rejects.toThrow('unsupported image extension');
    });

    it('retries ONLY on transient HTTP 429/5xx and never retries on 4xx client errors', async () => {
      const transientFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
        .mockResolvedValueOnce(new Response('Upstream error', { status: 503 }))
        .mockResolvedValueOnce(
          new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:retry-ok' } }),
        );
      vi.stubGlobal('fetch', transientFetch);

      const adapter = new LinkedInAdapter({ maxRetries: 2, retryDelayMs: 0 });
      const res = (await adapter.execute('publish-post', {
        commentary: 'Transient recovery post',
      })) as Record<string, unknown>;
      expect(transientFetch).toHaveBeenCalledTimes(3);
      expect(res.postUrn).toBe('urn:li:share:retry-ok');

      // 400 Bad Request must NOT retry
      const clientErrFetch = vi.fn().mockResolvedValue(new Response('Bad payload', { status: 400 }));
      vi.stubGlobal('fetch', clientErrFetch);
      await expect(
        adapter.execute('publish-post', { commentary: 'Invalid server reject' }),
      ).rejects.toThrow('HTTP 400');
      expect(clientErrFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Secret Redaction & Error Sanitization', () => {
    it('redacts Bearer tokens and raw access tokens from API error responses', async () => {
      const leakedHeader = 'Authorization: Bearer AQX_mock_linkedin_secret_token_987654321';
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 401,
            message: `Invalid token echoed: ${leakedHeader} and another Bearer someRandomLeakedToken999`,
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      vi.stubGlobal('fetch', mockFetch);

      const executor = new StandardStepExecutor();

      let caughtError = '';
      try {
        await executor.execute({
          id: 'step-li-profile',
          name: 'Inspect LinkedIn Profile',
          bridge: 'linkedin',
          action: 'profile-me',
          inputs: {},
        });
      } catch (err) {
        caughtError = (err as Error).message;
      }

      expect(caughtError).toContain('HTTP 401');
      expect(caughtError).not.toContain('AQX_mock_linkedin_secret_token_987654321');
      expect(caughtError).not.toContain('someRandomLeakedToken999');
      expect(caughtError).toContain('[REDACTED]');
    });
  });

  describe('Permission Tier Enforcement & Human-in-the-Loop Approval Gates', () => {
    it('enforces read/local-write auto-allow and external-write/publish approval blocks', async () => {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as BridgeManifest;
      const pm = new PermissionManager();

      expect(pm.checkPermission(manifest, 'profile-me').allowed).toBe(true);
      expect(pm.checkPermission(manifest, 'draft-post').allowed).toBe(true);

      const uploadCheck = pm.checkPermission(manifest, 'upload-image');
      expect(uploadCheck.allowed).toBe(false);
      expect(uploadCheck.requiresApproval).toBe(true);
      expect(uploadCheck.level).toBe('external-write');

      const publishCheck = pm.checkPermission(manifest, 'publish-post');
      expect(publishCheck.allowed).toBe(false);
      expect(publishCheck.requiresApproval).toBe(true);
      expect(publishCheck.level).toBe('publish');
    });

    it('blocks unattended publish-post via MCP and WorkflowEngine until explicitly approved', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 201,
          headers: { 'x-restli-id': 'urn:li:share:approved-post-1' },
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      // 1. Unattended MCP call must return blocked
      const mcp = new AgentForgeMcpServer(join(ROOT, 'bridges'));
      const mcpRes = await mcp.handleMessage({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'agentforge_run_action',
          arguments: {
            bridge: 'linkedin',
            action: 'publish-post',
            inputs: { commentary: 'Unattended attempt' },
          },
        },
      });
      const mcpParsed = JSON.parse((mcpRes?.result as { content: Array<{ text: string }> }).content[0].text);
      expect(mcpParsed.status).toBe('blocked');
      expect(mcpParsed.requiresApproval).toBe(true);
      expect(mcpParsed.level).toBe('publish');
      expect(mockFetch).not.toHaveBeenCalled();

      // 2. WorkflowEngine pauses at publish-post, executes only after explicit operator approval
      const registry = new BridgeRegistry(join(ROOT, 'bridges'));
      await registry.discover();
      const permissions = new PermissionManager();
      const engine = new WorkflowEngine(registry, permissions, new StandardStepExecutor());

      const workflow: WorkflowDefinition = {
        id: 'linkedin-publish-flow',
        name: 'Draft and Publish to LinkedIn',
        description: 'Validate draft locally then require approval to publish',
        steps: [
          {
            id: 'draft',
            name: 'Draft LinkedIn Post',
            bridge: 'linkedin',
            action: 'draft-post',
            inputs: {
              commentary: 'Approved AgentForge LinkedIn release post!',
              outputPath: join(tempDir, 'workflow-draft.json'),
            },
          },
          {
            id: 'publish',
            name: 'Publish LinkedIn Post',
            bridge: 'linkedin',
            action: 'publish-post',
            dependsOn: ['draft'],
            inputs: {
              commentary: '$steps.draft.output.payload.commentary',
            },
          },
        ],
      };

      const pausedRun = await engine.run(workflow);
      expect(pausedRun.status).toBe('paused_for_approval');
      expect(pausedRun.steps.find(s => s.stepId === 'draft')?.status).toBe('completed');
      expect(pausedRun.pendingApproval?.action).toBe('publish-post');
      expect(pausedRun.pendingApproval?.permissionLevel).toBe('publish');
      expect(mockFetch).not.toHaveBeenCalled();

      await engine.approveStep(pausedRun.runId, pausedRun.pendingApproval!.approvalRequestId, {
        approvedBy: 'hamza-operator',
        confirmed: true,
        reason: 'Reviewed LinkedIn post draft',
      });

      const completedRun = await engine.resumeRun(pausedRun.runId);
      expect(completedRun.status).toBe('completed');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const publishStep = completedRun.steps.find(s => s.stepId === 'publish');
      expect(publishStep?.status).toBe('completed');
      expect((publishStep?.output as Record<string, unknown>).postUrn).toBe(
        'urn:li:share:approved-post-1',
      );
    });
  });
});
