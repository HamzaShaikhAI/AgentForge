import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WordPressAdapter, WpPost, WpPage, WpCategory } from './wordpress.js';
import { BridgeValidator } from '../bridge-validator.js';

describe('WordPressAdapter & Bridge Manifest (Infinite Possibilities)', () => {
  let adapter: WordPressAdapter;

  beforeEach(() => {
    adapter = new WordPressAdapter({
      baseUrl: 'https://hamzashaikhai.com',
    });
  });

  describe('Manifest Schema Validation', () => {
    it('validates bridges/wordpress/bridge.json with 0 errors across all 21 capabilities', () => {
      const manifestPath = resolve(process.cwd(), 'bridges', 'wordpress', 'bridge.json');
      const raw = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);

      const validator = new BridgeValidator();
      const result = validator.validate(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(manifest.name).toBe('wordpress');
      expect(manifest.capabilities.length).toBe(21);
    });
  });

  describe('Adapter Metadata & Actions', () => {
    it('exposes correct metadata', () => {
      expect(adapter.name).toBe('wordpress');
      expect(adapter.displayName).toBe('WordPress CMS & Engine');
      expect(adapter.category).toBe('content-creation');
      expect(adapter.version).toBe('1.0.0');
    });

    it('declares 21 supported actions with strict permission policies', () => {
      const actions = adapter.getActions();
      expect(actions).toHaveLength(21);

      const readActions = [
        'get-site-info',
        'list-posts',
        'get-post',
        'list-pages',
        'list-media',
        'list-categories',
        'list-comments',
        'list-plugins',
        'list-themes',
        'get-settings',
      ];
      for (const a of readActions) {
        const found = actions.find(x => x.action === a);
        expect(found?.permissionLevel).toBe('read');
        expect(found?.requiresApproval).toBe(false);
      }

      const externalWriteActions = [
        'create-post',
        'update-post',
        'create-page',
        'upload-media',
        'create-category',
        'moderate-comment',
        'manage-plugin',
        'update-settings',
        'wp-cli-command',
        'universal-rest-api',
      ];
      for (const a of externalWriteActions) {
        const found = actions.find(x => x.action === a);
        expect(found?.permissionLevel).toBe('external-write');
        expect(found?.requiresApproval).toBe(true);
      }

      const deletePost = actions.find(a => a.action === 'delete-post');
      expect(deletePost?.permissionLevel).toBe('destructive');
      expect(deletePost?.requiresApproval).toBe(true);
    });

    it('returns healthy status via checkHealth()', async () => {
      const health = await adapter.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.details?.siteUrl).toBe('https://hamzashaikhai.com');
      expect(health.details?.postsCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Content Lifecycle (Posts & Pages)', () => {
    it('reads site info and existing posts', async () => {
      const siteInfo = (await adapter.execute('get-site-info')) as any;
      expect(siteInfo.name).toBe('Hamza Shaikh AI');
      expect(siteInfo.version).toBe('6.5.3');
      expect(siteInfo.namespaces).toContain('wp/v2');

      const postsRes = (await adapter.execute('list-posts')) as any;
      expect(postsRes.totalPosts).toBeGreaterThanOrEqual(1);
      expect(postsRes.posts[0].slug).toBe('welcome-to-hamza-shaikh-ai');
    });

    it('creates, updates, retrieves, and trashes a post', async () => {
      // 1. Create post
      const createRes = (await adapter.execute('create-post', {
        title: 'Building Autonomous AI Workflows with Antigravity',
        content: '<!-- wp:paragraph --><p>Full-stack agent orchestration on WordPress.</p><!-- /wp:paragraph -->',
        status: 'publish',
        excerpt: 'AI agent orchestration overview',
      })) as { success: boolean; postId: number; post: WpPost };

      expect(createRes.success).toBe(true);
      expect(createRes.postId).toBeDefined();
      expect(createRes.post.title.rendered).toBe('Building Autonomous AI Workflows with Antigravity');
      const postId = createRes.postId;

      // 2. Get post
      const getRes = (await adapter.execute('get-post', { postId })) as { post: WpPost };
      expect(getRes.post.title.rendered).toBe('Building Autonomous AI Workflows with Antigravity');

      // 3. Update post
      const updateRes = (await adapter.execute('update-post', {
        postId,
        title: 'Building Autonomous AI Workflows with Antigravity (Updated)',
      })) as { success: boolean; post: WpPost };

      expect(updateRes.success).toBe(true);
      expect(updateRes.post.title.rendered).toContain('(Updated)');

      // 4. Trash post
      const trashRes = (await adapter.execute('delete-post', { postId, force: false })) as any;
      expect(trashRes.success).toBe(true);
      expect(trashRes.message).toContain('moved to WordPress trash');

      // 5. Permanent delete
      const deleteRes = (await adapter.execute('delete-post', { postId, force: true })) as any;
      expect(deleteRes.success).toBe(true);
      expect(deleteRes.message).toContain('permanently deleted');
    });

    it('creates and lists pages', async () => {
      const createPageRes = (await adapter.execute('create-page', {
        title: 'AI Services Portfolio',
        content: '<p>Our autonomous AI agent offerings.</p>',
        status: 'publish',
        slug: 'services',
      })) as { success: boolean; pageId: number; page: WpPage };

      expect(createPageRes.success).toBe(true);
      expect(createPageRes.page.slug).toBe('services');

      const pagesRes = (await adapter.execute('list-pages')) as any;
      expect(pagesRes.totalCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Media, Taxonomies, and Plugins', () => {
    it('uploads media and lists media library', async () => {
      const uploadRes = (await adapter.execute('upload-media', {
        filePath: 'C:/assets/agentforge-logo.png',
        title: 'AgentForge Logo Badge',
        altText: 'AgentForge Official Emblem',
      })) as any;

      expect(uploadRes.success).toBe(true);
      expect(uploadRes.mediaId).toBeDefined();
      expect(uploadRes.sourceUrl).toContain('agentforge-logo.png');

      const listMediaRes = (await adapter.execute('list-media')) as any;
      expect(listMediaRes.totalCount).toBeGreaterThanOrEqual(2);
    });

    it('creates taxonomy category and lists categories', async () => {
      const catRes = (await adapter.execute('create-category', {
        name: 'Autonomous Systems',
        description: 'Systems acting independently on behalf of users',
      })) as { success: boolean; category: WpCategory };

      expect(catRes.success).toBe(true);
      expect(catRes.category.name).toBe('Autonomous Systems');

      const listCat = (await adapter.execute('list-categories')) as any;
      expect(listCat.categories.length).toBeGreaterThanOrEqual(3);
    });

    it('manages plugins (activation/deactivation)', async () => {
      const pluginsRes = (await adapter.execute('list-plugins')) as any;
      expect(pluginsRes.plugins.length).toBeGreaterThanOrEqual(3);
      expect(pluginsRes.activeCount).toBeGreaterThanOrEqual(2);

      const activateRes = (await adapter.execute('manage-plugin', {
        plugin: 'woocommerce/woocommerce.php',
        operation: 'activate',
      })) as any;

      expect(activateRes.success).toBe(true);
      expect(activateRes.operation).toBe('activate');
    });

    it('updates site settings', async () => {
      const updateRes = (await adapter.execute('update-settings', {
        title: 'Hamza Shaikh AI Official',
        description: 'Next-Generation Autonomous AI Systems',
      })) as any;

      expect(updateRes.success).toBe(true);
      expect(updateRes.settings.title).toBe('Hamza Shaikh AI Official');
    });
  });

  describe('Infinite Possibilities: WP-CLI & Universal REST API', () => {
    it('executes arbitrary WP-CLI commands safely', async () => {
      const cliRes = (await adapter.execute('wp-cli-command', {
        command: 'cache flush',
      })) as any;

      expect(cliRes.success).toBe(true);
      expect(cliRes.command).toBe('cache flush');
      expect(cliRes.stdout).toContain('cache flush');
      expect(cliRes.exitCode).toBe(0);
    });

    it('executes universal REST API requests with full freedom', async () => {
      const restRes = (await adapter.execute('universal-rest-api', {
        endpoint: '/wp-json/wp/v2/posts',
        method: 'GET',
      })) as any;

      expect(restRes.success).toBe(true);
      expect(restRes.status).toBe(200);
      expect(Array.isArray(restRes.data)).toBe(true);

      const customEndpointRes = (await adapter.execute('universal-rest-api', {
        endpoint: '/wp-json/wc/v3/orders',
        method: 'POST',
        payload: { customer_id: 42, total: '99.00' },
      })) as any;

      expect(customEndpointRes.success).toBe(true);
      expect(customEndpointRes.status).toBe(200);
      expect(customEndpointRes.data.acknowledged).toBe(true);
    });
  });
});
