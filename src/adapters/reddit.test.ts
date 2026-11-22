import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RedditAdapter } from './reddit.js';
import { BridgeValidator } from '../bridge-validator.js';

describe('RedditAdapter & Bridge Manifest (Social & Community Bridge)', () => {
  let adapter: RedditAdapter;

  beforeEach(() => {
    adapter = new RedditAdapter();
  });

  describe('Manifest Schema Validation', () => {
    it('validates bridges/reddit/bridge.json with 0 errors across all 17 capabilities', () => {
      const manifestPath = resolve(process.cwd(), 'bridges', 'reddit', 'bridge.json');
      const raw = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);

      const validator = new BridgeValidator();
      const result = validator.validate(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(manifest.name).toBe('reddit');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.capabilities.length).toBe(17);
    });
  });

  describe('Adapter Metadata & Actions', () => {
    it('exposes correct metadata', () => {
      expect(adapter.name).toBe('reddit');
      expect(adapter.displayName).toBe('Reddit Omni-Platform');
      expect(adapter.category).toBe('communication');
      expect(adapter.version).toBe('1.0.0');
    });

    it('declares 17 supported actions matching the manifest', () => {
      const actions = adapter.getActions();
      expect(actions).toHaveLength(17);

      const actionNames = actions.map((a) => a.action);
      expect(actionNames).toContain('get-subreddit');
      expect(actionNames).toContain('list-posts');
      expect(actionNames).toContain('get-post');
      expect(actionNames).toContain('create-post');
      expect(actionNames).toContain('edit-post');
      expect(actionNames).toContain('delete-post');
      expect(actionNames).toContain('get-comments');
      expect(actionNames).toContain('create-comment');
      expect(actionNames).toContain('edit-comment');
      expect(actionNames).toContain('delete-comment');
      expect(actionNames).toContain('vote');
      expect(actionNames).toContain('get-user-profile');
      expect(actionNames).toContain('search-reddit');
      expect(actionNames).toContain('moderate-post');
      expect(actionNames).toContain('moderate-comment');
      expect(actionNames).toContain('get-inbox');
      expect(actionNames).toContain('reddit-raw-api');
    });

    it('enforces requiresApproval on publish and destructive actions', () => {
      const actions = adapter.getActions();
      const createPost = actions.find((a) => a.action === 'create-post');
      expect(createPost?.requiresApproval).toBe(true);
      expect(createPost?.permissionLevel).toBe('publish');

      const delPost = actions.find((a) => a.action === 'delete-post');
      expect(delPost?.requiresApproval).toBe(true);
      expect(delPost?.permissionLevel).toBe('destructive');
    });
  });

  describe('Reddit Subreddit & Post Ingestion', () => {
    it('fetches subreddit metadata and community rules', async () => {
      const sub = (await adapter.execute('get-subreddit', { subreddit: 'r/programming' })) as any;
      expect(sub.success).toBe(true);
      expect(sub.subreddit).toBe('r/programming');
      expect(sub.subscribers).toBeGreaterThan(100000);
      expect(sub.rules.length).toBeGreaterThan(0);
    });

    it('lists posts and gets single post with comment tree', async () => {
      const list = (await adapter.execute('list-posts', { subreddit: 'programming', sort: 'hot' })) as any;
      expect(list.success).toBe(true);
      expect(list.posts.length).toBeGreaterThan(0);

      const post = (await adapter.execute('get-post', { postId: list.posts[0].id })) as any;
      expect(post.success).toBe(true);
      expect(post.post.title).toBeDefined();
    });
  });

  describe('Post Creation, Editing, and Voting', () => {
    it('submits a new post to a subreddit', async () => {
      const created = (await adapter.execute('create-post', {
        subreddit: 'programming',
        title: 'Announcing AgentForge 2.0 with Realtime Multi-Bridge Architecture',
        text: 'AgentForge connects local developers with autonomous AI agents across Google, Reddit, and Cloudflare.',
        flairText: 'Release',
      })) as any;

      expect(created.success).toBe(true);
      expect(created.postId).toBeDefined();
      expect(created.permalink).toContain('/r/programming/');
      expect(created.score).toBe(1);

      // Edit post
      const edited = (await adapter.execute('edit-post', {
        postId: created.postId,
        text: 'Updated post body with live documentation links.',
      })) as any;
      expect(edited.success).toBe(true);

      // Vote on post
      const voted = (await adapter.execute('vote', {
        targetId: created.postId,
        dir: 1,
      })) as any;
      expect(voted.success).toBe(true);
      expect(voted.direction).toBe(1);
    });

    it('deletes post permanently', async () => {
      const del = (await adapter.execute('delete-post', { postId: 'post_agentforge_01' })) as any;
      expect(del.success).toBe(true);
      expect(del.deleted).toBe(true);
    });
  });

  describe('Comments, Profile, and Moderation', () => {
    it('creates, edits, and deletes comments', async () => {
      const comm = (await adapter.execute('create-comment', {
        postId: 'post_tech_02',
        body: 'Gemini Omni native audio conditioning is a huge leap forward.',
      })) as any;
      expect(comm.success).toBe(true);
      expect(comm.commentId).toBeDefined();

      const editComm = (await adapter.execute('edit-comment', {
        commentId: comm.commentId,
        body: 'Updated comment text.',
      })) as any;
      expect(editComm.success).toBe(true);

      const delComm = (await adapter.execute('delete-comment', {
        commentId: comm.commentId,
      })) as any;
      expect(delComm.success).toBe(true);
    });

    it('retrieves user profile, inbox, and performs moderation actions', async () => {
      const profile = (await adapter.execute('get-user-profile')) as any;
      expect(profile.success).toBe(true);
      expect(profile.totalKarma).toBeGreaterThan(0);

      const inbox = (await adapter.execute('get-inbox')) as any;
      expect(inbox.success).toBe(true);
      expect(inbox.messages.length).toBeGreaterThan(0);

      const mod = (await adapter.execute('moderate-post', {
        postId: 'post_tech_02',
        action: 'lock',
      })) as any;
      expect(mod.success).toBe(true);
      expect(mod.modAction).toBe('lock');
    });

    it('throws error for unknown action', async () => {
      await expect(adapter.execute('invalid-reddit-action')).rejects.toThrow(
        'is not implemented by RedditAdapter'
      );
    });
  });
});
