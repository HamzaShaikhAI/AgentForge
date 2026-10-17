import { BaseIntegrationAdapter, AdapterHealthResult, AdapterActionDefinition } from './base-adapter.js';
import { YouTubeExecutor } from '../executors/youtube-executor.js';
import { GoogleOAuthService, YOUTUBE_UPLOAD_SCOPE } from '../auth/google-oauth.js';

export class YouTubeAdapter extends BaseIntegrationAdapter {
  readonly name = 'youtube';
  readonly displayName = 'YouTube Data API v3';
  readonly description = 'Inspect channels, list uploaded videos, and upload videos to YouTube.';
  readonly version = '1.0.0';
  readonly category = 'media';

  private youtubeExecutor: YouTubeExecutor;
  private googleOAuth: GoogleOAuthService;

  constructor(youtubeExecutor = new YouTubeExecutor(), googleOAuth = new GoogleOAuthService()) {
    super();
    this.youtubeExecutor = youtubeExecutor;
    this.googleOAuth = googleOAuth;
  }

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'channel-inspect', description: 'Inspect authenticated user channel metadata', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'channel-metadata', description: 'Query metadata for a specific YouTube channel', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'video-list', description: 'List videos uploaded to channel', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'video-upload', description: 'Upload a video to YouTube', permissionLevel: 'publish', sideEffects: true, requiresApproval: true },
      { action: 'set-thumbnail', description: 'Upload custom thumbnail for a video', permissionLevel: 'publish', sideEffects: true, requiresApproval: true },
      { action: 'playlist-add', description: 'Add a video to a playlist', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
      { action: 'community-post', description: 'Create a community post', permissionLevel: 'publish', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    try {
      const auth = await this.googleOAuth.getStatus();
      const hasUpload = await this.googleOAuth.hasScopes([YOUTUBE_UPLOAD_SCOPE]).catch(() => false);
      return {
        healthy: auth.accountConnected,
        status: auth.accountConnected ? 'connected' : (auth.clientConfigured ? 'configured' : 'unconfigured'),
        message: auth.accountConnected
          ? `Connected to YouTube as ${auth.connectedAccount || 'User'}`
          : (auth.clientConfigured ? 'Client configured, awaiting browser sign-in' : 'Awaiting Google OAuth configuration'),
        details: { accountEmail: auth.connectedAccount, uploadScope: hasUpload },
      };
    } catch (err) {
      return {
        healthy: false,
        status: 'error',
        message: (err as Error).message,
      };
    }
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    return this.youtubeExecutor.execute(action, inputs);
  }
}
