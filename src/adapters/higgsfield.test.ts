import { describe, it, expect, beforeEach } from 'vitest';
import { HiggsfieldAdapter } from './higgsfield.js';

describe('HiggsfieldAdapter', () => {
  let adapter: HiggsfieldAdapter;

  beforeEach(() => {
    adapter = new HiggsfieldAdapter();
  });

  it('exposes correct metadata and category', () => {
    expect(adapter.name).toBe('higgsfield');
    expect(adapter.displayName).toBe('Higgsfield AI Video');
    expect(adapter.category).toBe('ai-multimedia');
    expect(adapter.version).toBe('1.0.0');
  });

  it('returns healthy status in simulation mode when unconfigured', async () => {
    const health = await adapter.checkHealth();
    expect(health.healthy).toBe(true);
    expect(health.status).toBe('available');
    expect(health.details).toHaveProperty('simulation', true);
  });

  it('declares all expected actions with permission levels', () => {
    const actions = adapter.getActions();
    const actionNames = actions.map(a => a.action);

    expect(actionNames).toContain('generate-video-prompt');
    expect(actionNames).toContain('generate-image-to-video');
    expect(actionNames).toContain('control-camera-motion');
    expect(actionNames).toContain('create-character-avatar');
    expect(actionNames).toContain('lip-sync-video');
    expect(actionNames).toContain('upscale-video-4k');
    expect(actionNames).toContain('motion-transfer');
    expect(actionNames).toContain('get-generation-status');
    expect(actionNames).toContain('cancel-generation');
    expect(actionNames).toContain('download-video');
    expect(actionNames).toContain('list-generations');
    expect(actionNames).toContain('delete-generation');
    expect(actionNames).toContain('higgsfield-raw-api');

    const deleteAction = actions.find(a => a.action === 'delete-generation');
    expect(deleteAction?.permissionLevel).toBe('destructive');
    expect(deleteAction?.requiresApproval).toBe(true);
  });

  it('generates video from prompt with DoP camera motion', async () => {
    const res = await adapter.execute('generate-video-prompt', {
      prompt: 'Cyberpunk flying car zooming through rain',
      cameraMotion: 'fpv-flythrough',
      durationSec: 6,
    }) as any;

    expect(res.success).toBe(true);
    expect(res.status).toBe('completed');
    expect(res.cameraMotion).toBe('fpv-flythrough');
    expect(res.videoUrl).toContain('cdn.higgsfield.ai');
    expect(res.sha256).toBeDefined();
  });

  it('animates image to video', async () => {
    const res = await adapter.execute('generate-image-to-video', {
      imageUrl: 'https://example.com/character.png',
      prompt: 'Subtle hair blowing in wind',
    }) as any;

    expect(res.success).toBe(true);
    expect(res.status).toBe('completed');
    expect(res.videoUrl).toContain('.mp4');
  });

  it('controls camera motion with trajectory and speed', async () => {
    const res = await adapter.execute('control-camera-motion', {
      trajectory: 'orbit-360',
      speed: 'slow',
      prompt: 'Ancient stone temple in mist',
    }) as any;

    expect(res.success).toBe(true);
    expect(res.cameraPath.trajectory).toBe('orbit-360');
    expect(res.cameraPath.speed).toBe('slow');
  });

  it('creates character avatar and maintains consistency', async () => {
    const res = await adapter.execute('create-character-avatar', {
      characterName: 'Commander Jax',
      description: 'Scaffold engineer with titanium arm',
    }) as any;

    expect(res.success).toBe(true);
    expect(res.character.characterName).toBe('Commander Jax');
    expect(res.character.seed).toBeDefined();
  });

  it('downloads video with SHA-256 verification', async () => {
    const res = await adapter.execute('download-video', {
      videoUrl: 'https://cdn.higgsfield.ai/renders/test.mp4',
      destinationPath: './media/test.mp4',
    }) as any;

    expect(res.success).toBe(true);
    expect(res.savedPath).toBe('./media/test.mp4');
    expect(res.sha256).toHaveLength(64);
  });

  it('lists and deletes generations', async () => {
    const listRes = await adapter.execute('list-generations', { limit: 10 }) as any;
    expect(listRes.total).toBeGreaterThan(0);

    const targetId = listRes.generations[0].id;
    const delRes = await adapter.execute('delete-generation', { generationId: targetId }) as any;
    expect(delRes.success).toBe(true);
    expect(delRes.deleted).toBe(true);
  });

  it('throws when missing required parameters', async () => {
    await expect(adapter.execute('generate-video-prompt', {})).rejects.toThrow('generate-video-prompt requires "prompt"');
    await expect(adapter.execute('generate-image-to-video', {})).rejects.toThrow('generate-image-to-video requires "imageUrl"');
    await expect(adapter.execute('control-camera-motion', { prompt: 'test' })).rejects.toThrow('control-camera-motion requires "trajectory" and "prompt"');
  });
});
