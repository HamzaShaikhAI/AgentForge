import { describe, it, expect, vi } from 'vitest';
import { YouTubeExecutor } from './youtube-executor.js';
import { GoogleOAuthService, YOUTUBE_READONLY_SCOPE } from '../auth/google-oauth.js';
import { StandardStepExecutor } from './index.js';

describe('YouTubeExecutor (Real YouTube Data API v3 Read-Only Bridge)', () => {
  const MOCK_ACCESS_TOKEN = 'ya29.mock-youtube-access-token-xyz123';

  // Helper to create a mock GoogleOAuthService
  function createMockOAuth(options: {
    connected?: boolean;
    hasScope?: boolean;
    token?: string;
  } = {}) {
    const {
      connected = true,
      hasScope = true,
      token = MOCK_ACCESS_TOKEN,
    } = options;

    return {
      getStatus: vi.fn().mockResolvedValue({
        clientConfigured: true,
        accountConnected: connected,
        connectedAccount: connected ? 'user@example.com' : undefined,
        status: connected ? 'connected' : 'unconfigured',
        authMode: 'developer-config',
        grantedScopes: hasScope ? [YOUTUBE_READONLY_SCOPE, 'email'] : ['email'],
        available: connected && hasScope,
      }),
      hasScopes: vi.fn().mockImplementation((scopes: string[]) => {
        if (!hasScope) return Promise.resolve(false);
        return Promise.resolve(scopes.every((s) => s === YOUTUBE_READONLY_SCOPE || s === 'email'));
      }),
      getValidAccessToken: vi.fn().mockResolvedValue(token),
      isYouTubeAuthorized: vi.fn().mockResolvedValue(connected && hasScope),
    } as unknown as GoogleOAuthService;
  }

  // Helper to create mock fetchFn
  function createMockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    return vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      return handler(url, init);
    }) as unknown as typeof fetch;
  }

  describe('Authentication & Scope Verification', () => {
    it('throws when no Google account is connected', async () => {
      const mockOAuth = createMockOAuth({ connected: false });
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(executor.execute('channel-inspect')).rejects.toThrow(
        /No Google account connected/i,
      );
    });

    it('throws when account is connected but missing YouTube read-only scope', async () => {
      const mockOAuth = createMockOAuth({ connected: true, hasScope: false });
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(executor.execute('channel-inspect')).rejects.toThrow(
        /Missing required YouTube permission/i,
      );
    });

    it('throws for unsupported or unknown bridge actions', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(executor.execute('unsupported-action', {})).rejects.toThrow(
        /Unsupported or unimplemented action on YouTube bridge: "unsupported-action"/i,
      );
    });
  });

  describe('channel-inspect', () => {
    it('successfully inspects authenticated user channel and extracts metadata', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch((url) => {
        expect(url).toContain('/channels?');
        expect(url).toContain('mine=true');
        expect(url).toContain('part=snippet,contentDetails,statistics,status');

        return new Response(
          JSON.stringify({
            kind: 'youtube#channelListResponse',
            items: [
              {
                id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
                snippet: {
                  title: 'Google Developers',
                  description: 'The official YouTube channel for Google developers.',
                  customUrl: '@googledevelopers',
                  publishedAt: '2007-05-18T18:48:47Z',
                  thumbnails: {
                    default: { url: 'https://yt3.ggpht.com/default.jpg' },
                  },
                  country: 'US',
                },
                contentDetails: {
                  relatedPlaylists: {
                    uploads: 'UU_x5XG1OV2P6uZZ5FSM9Ttw',
                  },
                },
                statistics: {
                  viewCount: '245678901',
                  subscriberCount: '2340000',
                  hiddenSubscriberCount: false,
                  videoCount: '6214',
                },
                status: {
                  privacyStatus: 'public',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      const result = (await executor.execute('channel-inspect')) as any;

      expect(result.hasChannel).toBe(true);
      expect(result.channel).not.toBeNull();
      expect(result.channel.id).toBe('UC_x5XG1OV2P6uZZ5FSM9Ttw');
      expect(result.channel.title).toBe('Google Developers');
      expect(result.channel.customUrl).toBe('@googledevelopers');
      expect(result.channel.uploadsPlaylistId).toBe('UU_x5XG1OV2P6uZZ5FSM9Ttw');
      expect(result.channel.subscriberCount).toBe(2340000);
      expect(result.channel.videoCount).toBe(6214);
      expect(result.channel.privacyStatus).toBe('public');
    });

    it('handles empty results cleanly when authenticated Google account has no YouTube channel', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch(() => {
        return new Response(
          JSON.stringify({
            kind: 'youtube#channelListResponse',
            items: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      const result = (await executor.execute('channel-inspect')) as any;

      expect(result.hasChannel).toBe(false);
      expect(result.channel).toBeNull();
      expect(result.message).toContain('No YouTube channel found for the authenticated Google account');
    });
  });

  describe('channel-metadata', () => {
    it('retrieves channel metadata by channel handle', async () => {
      const mockOAuth = createMockOAuth();
      let requestedUrl = '';
      const mockFetch = createMockFetch((url) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            kind: 'youtube#channelListResponse',
            items: [
              {
                id: 'UCv6Gndc0vj4hK-c2o2zL0pw',
                snippet: {
                  title: 'TypeScript Official',
                  description: 'TypeScript news and updates.',
                  customUrl: '@typescript',
                  publishedAt: '2012-10-01T00:00:00Z',
                  thumbnails: {},
                },
                contentDetails: {
                  relatedPlaylists: {
                    uploads: 'UUv6Gndc0vj4hK-c2o2zL0pw',
                  },
                },
                statistics: {
                  viewCount: '150000',
                  subscriberCount: '50000',
                  videoCount: '45',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      const result = (await executor.execute('channel-metadata', { forHandle: '@typescript' })) as any;

      expect(requestedUrl).toContain('forHandle=typescript');
      expect(result.found).toBe(true);
      expect(result.channel.id).toBe('UCv6Gndc0vj4hK-c2o2zL0pw');
      expect(result.channel.title).toBe('TypeScript Official');
    });

    it('retrieves channel metadata by explicit channelId', async () => {
      const mockOAuth = createMockOAuth();
      let requestedUrl = '';
      const mockFetch = createMockFetch((url) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            kind: 'youtube#channelListResponse',
            items: [
              {
                id: 'UCcustom123',
                snippet: { title: 'Custom Channel' },
                contentDetails: { relatedPlaylists: { uploads: 'UUcustom123' } },
                statistics: { viewCount: '10', subscriberCount: '2', videoCount: '1' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      const result = (await executor.execute('channel-metadata', { channelId: 'UCcustom123' })) as any;

      expect(requestedUrl).toContain('id=UCcustom123');
      expect(result.found).toBe(true);
      expect(result.channel.id).toBe('UCcustom123');
    });

    it('returns found: false when no channel matches query', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch(() => {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      const result = (await executor.execute('channel-metadata', { forHandle: 'nonexistent' })) as any;

      expect(result.found).toBe(false);
      expect(result.channel).toBeNull();
      expect(result.message).toContain('No YouTube channel found matching the specified parameters');
    });
  });

  describe('video-list', () => {
    it('lists videos from the authenticated user uploads playlist automatically', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch((url) => {
        if (url.includes('/channels?')) {
          // Channel inspection for uploads playlist resolution
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'UCtestchannel',
                  snippet: { title: 'Test Channel' },
                  contentDetails: {
                    relatedPlaylists: {
                      uploads: 'UUtestchannel',
                    },
                  },
                  statistics: { viewCount: '100', subscriberCount: '10', videoCount: '2' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (url.includes('/playlistItems?')) {
          expect(url).toContain('playlistId=UUtestchannel');
          expect(url).toContain('maxResults=5');

          return new Response(
            JSON.stringify({
              kind: 'youtube#playlistItemListResponse',
              pageInfo: { totalResults: 2, resultsPerPage: 5 },
              nextPageToken: 'PAGE_TOKEN_NEXT',
              items: [
                {
                  id: 'item1',
                  contentDetails: { videoId: 'vid12345678', videoPublishedAt: '2026-01-15T12:00:00Z' },
                  snippet: {
                    title: 'AgentForge Getting Started',
                    description: 'Learn how to build secure agent bridges with AgentForge.',
                    publishedAt: '2026-01-15T12:00:00Z',
                    channelId: 'UCtestchannel',
                    channelTitle: 'Test Channel',
                    playlistId: 'UUtestchannel',
                    position: 0,
                    thumbnails: {
                      high: { url: 'https://i.ytimg.com/vi/vid12345678/hqdefault.jpg' },
                    },
                  },
                },
                {
                  id: 'item2',
                  contentDetails: { videoId: 'vid87654321' },
                  snippet: {
                    title: 'AgentForge Workflow Orchestration',
                    description: 'Deep dive into workflow execution and approval checkpoints.',
                    publishedAt: '2026-02-01T15:30:00Z',
                    channelId: 'UCtestchannel',
                    channelTitle: 'Test Channel',
                    playlistId: 'UUtestchannel',
                    position: 1,
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response('Not found', { status: 404 });
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      const result = (await executor.execute('video-list', { maxResults: 5 })) as any;

      expect(result.videos).toHaveLength(2);
      expect(result.totalResults).toBe(2);
      expect(result.nextPageToken).toBe('PAGE_TOKEN_NEXT');

      const first = result.videos[0];
      expect(first.videoId).toBe('vid12345678');
      expect(first.title).toBe('AgentForge Getting Started');
      expect(first.videoUrl).toBe('https://www.youtube.com/watch?v=vid12345678');
      expect(first.thumbnails.high.url).toContain('vid12345678');
    });

    it('supports direct playlistId and pageToken parameters without querying channels', async () => {
      const mockOAuth = createMockOAuth();
      let queriedChannels = false;

      const mockFetch = createMockFetch((url) => {
        if (url.includes('/channels?')) {
          queriedChannels = true;
          return new Response('{}', { status: 200 });
        }

        expect(url).toContain('playlistId=PLcustom_playlist_id');
        expect(url).toContain('pageToken=PAGE_TOKEN_123');

        return new Response(
          JSON.stringify({
            items: [
              {
                snippet: {
                  title: 'Video in Custom Playlist',
                  resourceId: { videoId: 'vid999' },
                  channelTitle: 'Creator',
                },
              },
            ],
            pageInfo: { totalResults: 1, resultsPerPage: 10 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      const result = (await executor.execute('video-list', {
        playlistId: 'PLcustom_playlist_id',
        pageToken: 'PAGE_TOKEN_123',
      })) as any;

      expect(queriedChannels).toBe(false);
      expect(result.videos).toHaveLength(1);
      expect(result.videos[0].videoId).toBe('vid999');
      expect(result.videos[0].videoUrl).toBe('https://www.youtube.com/watch?v=vid999');
    });

    it('returns empty video array when playlist has no items', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch(() => {
        return new Response(
          JSON.stringify({
            items: [],
            pageInfo: { totalResults: 0, resultsPerPage: 10 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      const result = (await executor.execute('video-list', { playlistId: 'PLempty' })) as any;

      expect(result.videos).toHaveLength(0);
      expect(result.totalResults).toBe(0);
      expect(result.message).toContain('No videos found in the playlist');
    });
  });

  describe('Error Discrimination & Secret Redaction', () => {
    it('discriminates 403 quotaExceeded error with actionable diagnostic', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch(() => {
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'The request cannot be completed because you have exceeded your quota.',
              errors: [{ reason: 'quotaExceeded', message: 'Quota exceeded' }],
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      await expect(executor.execute('channel-inspect')).rejects.toThrow(
        /YouTube API quota exceeded/i,
      );
    });

    it('discriminates 403 accessNotConfigured error (API not enabled in Google Cloud Console)', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch(() => {
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'YouTube Data API v3 has not been used in project 123456 before or it is disabled.',
              errors: [{ reason: 'accessNotConfigured' }],
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      await expect(executor.execute('channel-inspect')).rejects.toThrow(
        /YouTube Data API v3 is not enabled in your Google Cloud project/i,
      );
    });

    it('discriminates 403 insufficientPermissions error', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch(() => {
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'The request is missing a valid API key or OAuth 2.0 token.',
              errors: [{ reason: 'insufficientPermissions' }],
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      await expect(executor.execute('channel-inspect')).rejects.toThrow(
        /Insufficient OAuth permissions/i,
      );
    });

    it('discriminates 401 Unauthorized (expired or revoked token)', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch(() => {
        return new Response(
          JSON.stringify({
            error: {
              code: 401,
              message: 'Invalid Credentials',
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      await expect(executor.execute('channel-inspect')).rejects.toThrow(
        /Authentication failure: Invalid or expired/i,
      );
    });

    it('discriminates 404 channelNotFound', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch(() => {
        return new Response(
          JSON.stringify({
            error: {
              code: 404,
              message: 'Channel not found',
              errors: [{ reason: 'channelNotFound' }],
            },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      await expect(executor.execute('channel-inspect')).rejects.toThrow(
        /YouTube resource not found/i,
      );
    });

    it('redacts sensitive tokens from network failure error messages', async () => {
      const sensitiveToken = 'ya29.mock-test-sample-secret-token-1234567890';
      const mockOAuth = createMockOAuth({ token: sensitiveToken });
      const mockFetch = vi.fn().mockRejectedValue(
        new Error(`Failed to fetch from https://www.googleapis.com?token=${sensitiveToken}`),
      ) as unknown as typeof fetch;

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });

      try {
        await executor.execute('channel-inspect');
        expect.fail('Should have thrown network error');
      } catch (err) {
        const errorMsg = (err as Error).message;
        expect(errorMsg).not.toContain(sensitiveToken);
        expect(errorMsg).toContain('[REDACTED]');
      }
    });

    it('throws when YouTube API returns non-JSON body', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch(() => {
        return new Response('<html>502 Bad Gateway</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      await expect(executor.execute('channel-inspect')).rejects.toThrow(
        /YouTube API returned an invalid non-JSON response/i,
      );
    });
  });

  describe('StandardStepExecutor Dispatcher Integration', () => {
    it('dispatches bridge "youtube" to YouTubeExecutor correctly', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch(() => {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'UCdispatcherTest',
                snippet: { title: 'Dispatcher Test Channel' },
                contentDetails: { relatedPlaylists: { uploads: 'UUdispatcherTest' } },
                statistics: { viewCount: '1', subscriberCount: '1', videoCount: '1' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const ytExecutor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });
      const standardExecutor = new StandardStepExecutor({
        youtubeExecutor: ytExecutor,
      });

      const result = (await standardExecutor.execute({
        bridge: 'youtube',
        action: 'channel-inspect',
        inputs: {},
      })) as any;

      expect(result.hasChannel).toBe(true);
      expect(result.channel.id).toBe('UCdispatcherTest');
    });
  });
});
