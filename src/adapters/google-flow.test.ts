import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { GoogleFlowAdapter } from './google-flow.js';
import { BridgeValidator } from '../bridge-validator.js';

describe('GoogleFlowAdapter & Bridge Manifest (Google Flow Credits & GenAI Suite)', () => {
  let adapter: GoogleFlowAdapter;

  beforeEach(() => {
    adapter = new GoogleFlowAdapter();
  });

  describe('Manifest Schema Validation', () => {
    it('validates bridges/google-flow/bridge.json with 0 errors across all 20 multimedia capabilities', () => {
      const manifestPath = resolve(process.cwd(), 'bridges', 'google-flow', 'bridge.json');
      const raw = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);

      const validator = new BridgeValidator();
      const result = validator.validate(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(manifest.name).toBe('google-flow');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.capabilities.length).toBe(20);
    });
  });

  describe('Adapter Metadata & Actions', () => {
    it('exposes correct metadata', () => {
      expect(adapter.name).toBe('google-flow');
      expect(adapter.displayName).toBe('Google Flow Media Studio');
      expect(adapter.category).toBe('media');
      expect(adapter.version).toBe('1.0.0');
    });

    it('declares 20 supported actions matching the manifest', () => {
      const actions = adapter.getActions();
      expect(actions).toHaveLength(20);

      const actionNames = actions.map((a) => a.action);
      expect(actionNames).toContain('get-credit-balance');
      expect(actionNames).toContain('claim-daily-credits');
      expect(actionNames).toContain('set-subscription-tier');
      expect(actionNames).toContain('generate-video');
      expect(actionNames).toContain('get-video-status');
      expect(actionNames).toContain('extend-video');
      expect(actionNames).toContain('generate-image');
      expect(actionNames).toContain('edit-image');
      expect(actionNames).toContain('upscale-image');
      expect(actionNames).toContain('generate-music');
      expect(actionNames).toContain('generate-tts');
      expect(actionNames).toContain('generate-sfx');
      expect(actionNames).toContain('download-media');
      expect(actionNames).toContain('inspect-media');
      expect(actionNames).toContain('list-media-assets');
      expect(actionNames).toContain('transcribe-media');
      expect(actionNames).toContain('compose-video');
      expect(actionNames).toContain('google-flow-raw-api');
      expect(actionNames).toContain('get-or-create-project');
      expect(actionNames).toContain('fetch-realtime-credits');
    });

    it('enforces requiresApproval on publish actions', () => {
      const actions = adapter.getActions();
      const genVid = actions.find((a) => a.action === 'generate-video');
      expect(genVid?.requiresApproval).toBe(true);
      expect(genVid?.permissionLevel).toBe('publish');

      const compose = actions.find((a) => a.action === 'compose-video');
      expect(compose?.requiresApproval).toBe(true);
      expect(compose?.permissionLevel).toBe('publish');
    });
  });

  describe('Health Checks & Credit Wallet', () => {
    it('reports connected status powered by Google Flow credits with zero required paid API key', async () => {
      const health = await adapter.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.status).toBe('connected');
      expect(health.message).toContain('Google Flow Credits Active: 1050 credits available');
      expect(health.details?.dailyRemaining).toBe(50);
      expect(health.details?.subscriptionCredits).toBe(1000);
      expect(health.details?.totalAvailable).toBe(1050);
    });

    it('returns full credit breakdown via get-credit-balance', async () => {
      const result = (await adapter.execute('get-credit-balance')) as any;
      expect(result.success).toBe(true);
      expect(result.wallet.totalAvailable).toBe(1050);
      expect(result.wallet.dailyRemaining).toBe(50);
      expect(result.wallet.subscriptionCredits).toBe(1000);
      expect(result.pricing.videoGeneration).toBe(10);
      expect(result.pricing.musicStudio).toBe(5);
      expect(result.pricing.imageGeneration).toBe(1);
    });

    it('allows claiming 50 free daily credits and updating subscription tier', async () => {
      // Deduct some credits first
      await adapter.execute('generate-image', { prompt: 'Test credit burn' });
      
      const claim = (await adapter.execute('claim-daily-credits')) as any;
      expect(claim.success).toBe(true);
      expect(claim.wallet.dailyRemaining).toBe(50);

      const tierUpdate = (await adapter.execute('set-subscription-tier', { tier: 'ultra' })) as any;
      expect(tierUpdate.success).toBe(true);
      expect(tierUpdate.wallet.subscriptionCredits).toBe(10000);
    });
  });

  describe('Video Generation (Veo / Gemini Omni)', () => {
    it('generates high-definition video from text prompt with aspect ratio and duration control (costs 10 credits)', async () => {
      const result = (await adapter.execute('generate-video', {
        prompt: 'Futuristic hyperloop train racing through cybernetic mountains with veo model',
        durationSeconds: 10,
        aspectRatio: '16:9',
        resolution: '1080p',
        fps: 30,
        model: 'google-veo-2.0',
      })) as any;

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.durationSeconds).toBe(10);
      expect(result.model).toBe('google-veo-2.0');
      expect(result.videoUrl).toContain('veo-vid-');
      expect(result.creditsDeducted).toBe(10);
    });

    it('generates conversational video with Gemini Omni 1.2 Flash model', async () => {
      const omni = (await adapter.execute('generate-video', {
        prompt: 'Cinematic drone shot of cybernetic skyline at golden hour with audio sync',
        model: 'gemini-omni-1.2-flash',
        cameraMotion: 'orbit-360',
        audioConditioning: true,
      })) as any;

      expect(omni.success).toBe(true);
      expect(omni.model).toBe('gemini-omni-1.2-flash');
      expect(omni.videoUrl).toContain('omni-vid-');
      expect(omni.cameraMotion).toBe('orbit-360');
      expect(omni.hasNativeAudio).toBe(true);
    });

    it('polls video rendering status and extends an existing sequence (costs 5 credits)', async () => {
      const status = (await adapter.execute('get-video-status', { videoId: 'vid-test-01' })) as any;
      expect(status.success).toBe(true);
      expect(status.progressPercent).toBeGreaterThan(0);

      const extended = (await adapter.execute('extend-video', {
        videoId: 'vid-test-01',
        prompt: 'Camera zooms out revealing orbital station above planet',
        additionalSeconds: 5,
        model: 'gemini-omni-1.2-flash',
      })) as any;

      expect(extended.success).toBe(true);
      expect(extended.extendedVideoId).toBeDefined();
      expect(extended.totalDurationSeconds).toBe(15);
      expect(extended.creditsDeducted).toBe(5);
    });
  });

  describe('Image Synthesis & Enhancement (Nano Banana & Imagen 3)', () => {
    it('generates images using Imagen 3 with style and aspect ratio parameters', async () => {
      const result = (await adapter.execute('generate-image', {
        prompt: 'Autonomous robotic assistant assembling quantum microprocessor',
        aspectRatio: '16:9',
        style: 'cinematic',
        samples: 2,
        model: 'imagen-3.0-generate-002',
      })) as any;

      expect(result.success).toBe(true);
      expect(result.model).toBe('imagen-3.0-generate-002');
      expect(result.images).toHaveLength(2);
      expect(result.creditsDeducted).toBe(1);
    });

    it('generates conversational images using Nano Banana with character consistency and typography', async () => {
      const nano = (await adapter.execute('generate-image', {
        prompt: 'Cyberpunk barista serving espresso with neon sign reading NANO BANANA',
        model: 'nano-banana',
        characterConsistencyLock: true,
        typographyRendering: true,
      })) as any;

      expect(nano.success).toBe(true);
      expect(nano.model).toBe('nano-banana');
      expect(nano.characterConsistency).toBe(true);
      expect(nano.typographyRendering).toBe(true);
      expect(nano.images[0].url).toContain('img-nano-banana-');
    });

    it('edits images conversationally with Nano Banana and upscales 4x', async () => {
      const edit = (await adapter.execute('edit-image', {
        prompt: 'Change barista jacket color to glowing emerald green',
        model: 'nano-banana',
        characterConsistencyLock: true,
      })) as any;

      expect(edit.success).toBe(true);
      expect(edit.characterConsistencyLock).toBe(true);
      expect(edit.model).toBe('nano-banana');

      const upscale = (await adapter.execute('upscale-image', {
        scaleFactor: 4,
      })) as any;

      expect(upscale.success).toBe(true);
      expect(upscale.scaleFactor).toBe('4x');
      expect(upscale.targetResolution).toBe('4096x4096');
    });
  });

  describe('Music & Audio Generation (Google Flow Music / TTS / SFX)', () => {
    it('generates rich music tracks with lyrics, AI Producer chat, vocals, instruments, and stems (costs 5 credits)', async () => {
      const music = (await adapter.execute('generate-music', {
        prompt: 'Uplifting synthwave theme with heavy driving bassline',
        lyrics: '[Verse 1]\nCode is running through the night\nAgents building in the light',
        aiProducerChat: 'Make the bass punchy and add stereo arpeggio',
        genre: 'synthwave',
        mood: 'heroic',
        bpm: 130,
        vocalist: 'melodic-female',
        stems: true,
      })) as any;

      expect(music.success).toBe(true);
      expect(music.platform).toBe('Google Flow Music');
      expect(music.bpm).toBe(130);
      expect(music.vocalist).toBe('melodic-female');
      expect(music.audioUrl).toBeDefined();
      expect(music.lyrics).toContain('Code is running through the night');
      expect(music.aiProducerChat).toBe('Make the bass punchy and add stereo arpeggio');
      expect(music.stems?.drumsUrl).toBeDefined();
      expect(music.stems?.bassUrl).toBeDefined();
      expect(music.waveform).toHaveLength(64);
      expect(music.creditsDeducted).toBe(5);
    });

    it('synthesizes expressive multi-voice text-to-speech voiceovers', async () => {
      const tts = (await adapter.execute('generate-tts', {
        text: 'AgentForge Google Flow is now operational across all modalities.',
        voice: 'Aoede',
        cadence: 'expressive',
      })) as any;

      expect(tts.success).toBe(true);
      expect(tts.voice).toBe('Aoede');
      expect(tts.audioUrl).toContain('tts-gemini-');
      expect(tts.creditsDeducted).toBe(1);
    });

    it('generates procedural sound effects', async () => {
      const sfx = (await adapter.execute('generate-sfx', {
        prompt: 'Futuristic holographic menu switch click',
        category: 'ui_click',
        durationSeconds: 1,
      })) as any;

      expect(sfx.success).toBe(true);
      expect(sfx.category).toBe('ui_click');
      expect(sfx.creditsDeducted).toBe(1);
    });
  });

  describe('Media Downloading, Ingestion & Probing (0 Credits Free)', () => {
    it('downloads media asset to local disk and computes cryptographic SHA-256 hash', async () => {
      const dl = (await adapter.execute('download-media', {
        filename: 'test-download-asset.mp4',
        url: 'https://storage.googleapis.com/agentforge-media/veo-tokyo-neon-rain.mp4',
      })) as any;

      expect(dl.success).toBe(true);
      expect(dl.filename).toBe('test-download-asset.mp4');
      expect(dl.sha256).toBeDefined();
      expect(dl.fileSizeBytes).toBeGreaterThan(0);
      expect(dl.creditsDeducted).toBe(0);
    });

    it('probes video and audio media streams for technical metadata without deducting credits', async () => {
      const vidProbe = (await adapter.execute('inspect-media', { target: 'veo-tokyo-neon-rain.mp4' })) as any;
      expect(vidProbe.success).toBe(true);
      expect(vidProbe.type).toBe('video');
      expect(vidProbe.resolution).toBe('1920x1080');
      expect(vidProbe.fps).toBe(30);
      expect(vidProbe.creditsDeducted).toBe(0);

      const audProbe = (await adapter.execute('inspect-media', { target: 'lyria-synthwave-pulse.mp3' })) as any;
      expect(audProbe.success).toBe(true);
      expect(audProbe.type).toBe('audio');
      expect(audProbe.durationSeconds).toBe(30);
    });

    it('lists generated assets in the media library', async () => {
      const list = (await adapter.execute('list-media-assets')) as any;
      expect(list.success).toBe(true);
      expect(list.assets.length).toBeGreaterThanOrEqual(3);
      expect(list.wallet.totalAvailable).toBeDefined();
    });
  });

  describe('Transcription & Multimedia Composition', () => {
    it('transcribes media files into timestamped SRT subtitles', async () => {
      const sub = (await adapter.execute('transcribe-media', {
        filePath: 'veo-tokyo-neon-rain.mp4',
      })) as any;

      expect(sub.success).toBe(true);
      expect(sub.languageDetected).toBe('en');
      expect(sub.segments.length).toBeGreaterThan(0);
      expect(sub.segments[0].start).toBeDefined();
    });

    it('composes video, background music, and voiceover into a final production cut', async () => {
      const comp = (await adapter.execute('compose-video', {
        video: 'https://storage.googleapis.com/agentforge-media/veo-tokyo-neon-rain.mp4',
        music: 'https://storage.googleapis.com/agentforge-media/lyria-synthwave-pulse.mp3',
        voice: 'https://storage.googleapis.com/agentforge-media/tts-narration.mp3',
      })) as any;

      expect(comp.success).toBe(true);
      expect(comp.status).toBe('completed');
      expect(comp.outputUrl).toContain('comp-');
      expect(comp.audioTracksMixed).toContain('background_music');
    });

    it('executes universal raw Google Flow API calls', async () => {
      const raw = (await adapter.execute('google-flow-raw-api', {
        endpoint: '/flow/v1/generate',
      })) as any;

      expect(raw.success).toBe(true);
      expect(raw.result.candidates.length).toBeGreaterThan(0);
    });

    it('throws error for unknown actions', async () => {
      await expect(adapter.execute('invalid-media-action')).rejects.toThrow(
        'is not implemented by GoogleFlowAdapter'
      );
    });

    it('enforces insufficient credit limits when wallet is depleted', async () => {
      // Deplete all credits
      const freeAdapter = new GoogleFlowAdapter({ tier: 'free' });
      // Free starts with 50 daily and 0 subscription = 50 total.
      // Call 10-credit video 5 times = 50 credits used.
      for (let i = 0; i < 5; i++) {
        await freeAdapter.execute('generate-video', { prompt: `Clip ${i}` });
      }
      
      // 6th video generation requires 10 credits but 0 available
      await expect(
        freeAdapter.execute('generate-video', { prompt: 'Out of credits video' })
      ).rejects.toThrow('Insufficient Google Flow credits');
    });
  });
});
