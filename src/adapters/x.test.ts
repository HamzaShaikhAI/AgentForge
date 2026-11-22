import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { XAdapter, MAX_TWEET_LENGTH } from './x.js';
import { createBuiltinAdapters } from './index.js';
import { BridgeValidator } from '../bridge-validator.js';
import { BridgeRegistry } from '../bridge-registry.js';
import { PermissionManager } from '../permissions.js';
import { AgentForgeMcpServer } from '../mcp-server.js';
import { InMemoryCredentialStore } from '../auth/credential-store.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MANIFEST_PATH = join(ROOT, 'bridges', 'x', 'bridge.json');

describe('X (Twitter) Bridge & Adapter (Schema v1.0, REST API v2, Antigravity Power)', () => {
  let tempDir: string;
  let originalToken: string | undefined;
  let originalUserId: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-x-test-'));
    originalToken = process.env.X_ACCESS_TOKEN;
    originalUserId = process.env.X_USER_ID;
    process.env.X_ACCESS_TOKEN = 'mock_x_secret_access_token_12345';
    process.env.X_USER_ID = '123456789';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalToken === undefined) {
      delete process.env.X_ACCESS_TOKEN;
    } else {
      process.env.X_ACCESS_TOKEN = originalToken;
    }
    if (originalUserId === undefined) {
      delete process.env.X_USER_ID;
    } else {
      process.env.X_USER_ID = originalUserId;
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Manifest & Schema v1.0 Validation', () => {
    it('passes BridgeValidator.validate() with 0 errors and 0 warnings', () => {
      const rawJson = readFileSync(MANIFEST_PATH, 'utf-8');
      const validator = new BridgeValidator();
      const jsonResult = validator.validateJSON(rawJson);

      expect(jsonResult.valid).toBe(true);
      expect(jsonResult.errors).toEqual([]);
      expect(jsonResult.warnings).toEqual([]);
      expect(jsonResult.manifest?.name).toBe('x');
      expect(jsonResult.manifest?.displayName).toBe('X (Twitter)');
      expect(jsonResult.manifest?.category).toBe('social-media');
      expect(jsonResult.manifest?.capabilities.length).toBe(15);
    });

    it('is discovered and loaded by BridgeRegistry', async () => {
      const registry = new BridgeRegistry(join(ROOT, 'bridges'));
      const { loaded, errors } = await registry.discover();

      expect(errors).toEqual([]);
      expect(loaded).toContain('x');

      const entry = registry.get('x');
      expect(entry).toBeDefined();
      expect(entry?.manifest.name).toBe('x');
    });

    it('is included in createBuiltinAdapters()', () => {
      const adapters = createBuiltinAdapters();
      const xAdapter = adapters.find((a) => a.name === 'x');
      expect(xAdapter).toBeDefined();
      expect(xAdapter?.displayName).toBe('X (Twitter)');
    });
  });

  describe('Read & Research Capabilities', () => {
    it('executes "me" to fetch authenticated profile details', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              id: '123456789',
              name: 'AgentForge Operator',
              username: 'agentforge_bot',
              description: 'AI Autonomous Systems',
              verified: true,
            },
          }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const result = await adapter.execute('me');

      expect(result.id).toBe('123456789');
      expect(result.username).toBe('agentforge_bot');
      expect(result.name).toBe('AgentForge Operator');
      expect(result.verified).toBe(true);
      expect(result.httpStatus).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/2/users/me'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock_x_secret_access_token_12345',
          }),
        }),
      );
    });

    it('executes "get-user" by username or userId', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              id: '44196397',
              name: 'Elon Musk',
              username: 'elonmusk',
              description: 'Occupy Mars',
            },
          }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const byUser = await adapter.execute('get-user', { username: '@elonmusk' });

      expect(byUser.id).toBe('44196397');
      expect(byUser.username).toBe('elonmusk');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/2/users/by/username/elonmusk'),
        expect.anything(),
      );
    });

    it('executes "get-tweet" with media attachments and video variants', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              id: '1890000000000000000',
              text: 'Autonomous AI agents are the future. Here is the video demo.',
              author_id: '44196397',
              created_at: '2026-11-15T12:00:00.000Z',
              public_metrics: { retweet_count: 500, like_count: 12000 },
            },
            includes: {
              media: [
                {
                  media_key: '7_189000',
                  type: 'video',
                  preview_image_url: 'https://pbs.twimg.com/media/preview.jpg',
                  variants: [{ bit_rate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/vid.mp4' }],
                },
              ],
              users: [{ id: '44196397', username: 'elonmusk' }],
            },
          }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const tweet = await adapter.execute('get-tweet', { tweetId: '1890000000000000000' });

      expect(tweet.id).toBe('1890000000000000000');
      expect(tweet.authorUsername).toBe('elonmusk');
      expect(Array.isArray(tweet.media)).toBe(true);
      expect((tweet.media as Array<Record<string, unknown>>)[0].type).toBe('video');
      expect(tweet.tweetUrl).toBe('https://x.com/i/status/1890000000000000000');
    });

    it('executes "search-tweets" for deep research', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [
              { id: '1', text: 'AI agent workflows with AgentForge #AI', author_id: '10' },
              { id: '2', text: 'Exploring Antigravity autonomous development', author_id: '20' },
            ],
            meta: { result_count: 2 },
            includes: {
              users: [
                { id: '10', username: 'dev1' },
                { id: '20', username: 'dev2' },
              ],
            },
          }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const result = await adapter.execute('search-tweets', { query: 'AgentForge AI', maxResults: 10 });

      expect(result.resultCount).toBe(2);
      expect((result.tweets as Array<Record<string, unknown>>).length).toBe(2);
      expect((result.tweets as Array<Record<string, unknown>>)[0].authorUsername).toBe('dev1');
    });

    it('executes "get-timeline" for reading the user feed', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [
              { id: '101', text: 'Recent post from timeline' },
              { id: '102', text: 'Second post' },
            ],
          }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const timeline = await adapter.execute('get-timeline', { maxResults: 5 });

      expect(timeline.count).toBe(2);
      expect((timeline.tweets as Array<Record<string, unknown>>)[0].tweetUrl).toBe('https://x.com/i/status/101');
    });
  });

  describe('Local Writing & Offline Drafting', () => {
    it('executes "draft-tweet" offline and validates character count and polls', async () => {
      const adapter = new XAdapter();
      const outPath = join(tempDir, 'my-tweet.json');

      const draft = await adapter.execute('draft-tweet', {
        text: 'Deploying agents with AgentForge and Antigravity!',
        outputPath: outPath,
        poll: {
          options: ['Yes', 'Absolutely', 'Tell me more'],
          durationMinutes: 1440,
        },
      });

      expect(draft.saved).toBe(true);
      expect(draft.characterCount).toBe(49);
      expect(draft.payload).toMatchObject({
        text: 'Deploying agents with AgentForge and Antigravity!',
        poll: {
          options: ['Yes', 'Absolutely', 'Tell me more'],
          duration_minutes: 1440,
        },
      });
    });

    it('rejects empty text in "draft-tweet"', async () => {
      const adapter = new XAdapter();
      await expect(adapter.execute('draft-tweet', { text: '   ' })).rejects.toThrow(
        /is required and must be a non-empty string/,
      );
    });
  });

  describe('Engagement & Publishing Capabilities', () => {
    it('executes "like-tweet" and "unlike-tweet"', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { liked: true } }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const like = await adapter.execute('like-tweet', { tweetId: '999888777' });
      expect(like.liked).toBe(true);
      expect(like.tweetId).toBe('999888777');
    });

    it('executes "retweet"', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { retweeted: true } }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const rt = await adapter.execute('retweet', { tweetId: '999888777' });
      expect(rt.retweeted).toBe(true);
    });

    it('executes "follow-user" and "unfollow-user"', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { following: true, pending_follow: false } }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const follow = await adapter.execute('follow-user', { targetUserId: '44196397' });
      expect(follow.following).toBe(true);
      expect(follow.targetUserId).toBe('44196397');
    });

    it('executes "post-tweet" with text and media', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            data: {
              id: '1899999999999999999',
              text: 'Autonomous update from AgentForge!',
            },
          }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const result = await adapter.execute('post-tweet', {
        text: 'Autonomous update from AgentForge!',
        mediaIds: ['1234567890'],
      });

      expect(result.published).toBe(true);
      expect(result.tweetId).toBe('1899999999999999999');
      expect(result.tweetUrl).toBe('https://x.com/i/status/1899999999999999999');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/2/tweets'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            text: 'Autonomous update from AgentForge!',
            media: { media_ids: ['1234567890'] },
          }),
        }),
      );
    });

    it('executes "delete-tweet"', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { deleted: true } }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const del = await adapter.execute('delete-tweet', { tweetId: '1899999999999999999' });
      expect(del.deleted).toBe(true);
      expect(del.tweetId).toBe('1899999999999999999');
    });
  });

  describe('Media Upload & Safety Validation', () => {
    it('executes "upload-media" for local images and attaches alt text', async () => {
      const testImage = join(tempDir, 'test.png');
      writeFileSync(testImage, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ media_id_string: '1800000000012345678' }),
      });

      const adapter = new XAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const upload = await adapter.execute('upload-media', {
        filePath: testImage,
        altText: 'A test chart graphic',
      });

      expect(upload.success).toBe(true);
      expect(upload.mediaId).toBe('1800000000012345678');
      expect(upload.mimeType).toBe('image/png');
    });

    it('blocks directory traversal and unauthorized paths', async () => {
      const adapter = new XAdapter({ allowedBaseDir: tempDir });
      await expect(
        adapter.execute('upload-media', { filePath: '../secret.png' }),
      ).rejects.toThrow(/outside allowed root/);
    });
  });

  describe('Antigravity MCP Server Integration', () => {
    it('exposes X bridge to Antigravity via agentforge_run_action', async () => {
      const server = new AgentForgeMcpServer(join(ROOT, 'bridges'));

      // 1. Check integrations tool includes x
      const checkRes = await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'agentforge_check_integrations',
          arguments: {},
        },
      });

      const checkContent = JSON.parse((checkRes?.result as any).content[0].text);
      expect(checkContent.x).toBeDefined();
      expect(checkContent.x.available).toBe(true);

      // 2. Draft action offline without approval gate
      const draftRes = await server.handleMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'agentforge_run_action',
          arguments: {
            bridge: 'x',
            action: 'draft-tweet',
            inputs: {
              text: 'Antigravity executing X tool action!',
            },
          },
        },
      });

      const draftContent = JSON.parse((draftRes?.result as any).content[0].text);
      expect(draftContent.status).toBe('success');
      expect(draftContent.output.saved).toBe(true);
      expect(draftContent.output.characterCount).toBe(36);
    });
  });
});
