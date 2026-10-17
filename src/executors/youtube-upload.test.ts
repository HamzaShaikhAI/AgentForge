import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeFileSync, unlinkSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { YouTubeExecutor } from './youtube-executor.js';
import {
  GoogleOAuthService,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
} from '../auth/google-oauth.js';
import { sanitizeErrorString } from '../auth/redact.js';
import { StandardStepExecutor } from './index.js';
import { BridgeRegistry } from '../bridge-registry.js';
import { PermissionManager } from '../permissions.js';
import { WorkflowEngine } from '../workflow-engine.js';
import { WorkflowDefinition, BridgeManifest } from '../types.js';

describe('YouTubeExecutor — Video Upload & Publishing (Milestone 6B)', () => {
  const MOCK_ACCESS_TOKEN = 'ya29.mock-youtube-upload-token-xyz999';
  let tempDir: string;
  let validVideoPath: string;
  let emptyVideoPath: string;
  let textFilePath: string;
  let videoContent: Buffer;
  let videoSha256: string;
  let videoSize: number;

  beforeEach(() => {
    tempDir = join(tmpdir(), `agentforge-yt-upload-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    mkdirSync(tempDir, { recursive: true });

    // Create a mock MP4 file with binary data
    videoContent = Buffer.from('FAKE-MP4-VIDEO-BINARY-STREAM-AGENTFORGE-TEST-CONTENT'.repeat(100));
    videoSha256 = createHash('sha256').update(videoContent).digest('hex');
    videoSize = videoContent.length;

    validVideoPath = join(tempDir, 'demo-presentation.mp4');
    writeFileSync(validVideoPath, videoContent);

    emptyVideoPath = join(tempDir, 'zero-byte.mp4');
    writeFileSync(emptyVideoPath, Buffer.alloc(0));

    textFilePath = join(tempDir, 'notes.txt');
    writeFileSync(textFilePath, 'Not a video file');
  });

  afterEach(() => {
    if (existsSync(validVideoPath)) unlinkSync(validVideoPath);
    if (existsSync(emptyVideoPath)) unlinkSync(emptyVideoPath);
    if (existsSync(textFilePath)) unlinkSync(textFilePath);
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  // Helper to create mock GoogleOAuthService
  function createMockOAuth(options: {
    connected?: boolean;
    hasUploadScope?: boolean;
    token?: string;
  } = {}) {
    const {
      connected = true,
      hasUploadScope = true,
      token = MOCK_ACCESS_TOKEN,
    } = options;

    const grantedScopes = ['email'];
    if (hasUploadScope) {
      grantedScopes.push(YOUTUBE_READONLY_SCOPE, YOUTUBE_UPLOAD_SCOPE);
    } else {
      grantedScopes.push(YOUTUBE_READONLY_SCOPE);
    }

    return {
      getStatus: vi.fn().mockResolvedValue({
        clientConfigured: true,
        accountConnected: connected,
        connectedAccount: connected ? 'creator@example.com' : undefined,
        status: connected ? 'connected' : 'unconfigured',
        authMode: 'developer-config',
        grantedScopes,
        available: connected && hasUploadScope,
      }),
      hasScopes: vi.fn().mockImplementation((scopes: string[]) => {
        if (!connected) return Promise.resolve(false);
        return Promise.resolve(scopes.every((s) => grantedScopes.includes(s)));
      }),
      getValidAccessToken: vi.fn().mockResolvedValue(token),
      isYouTubeAuthorized: vi.fn().mockResolvedValue(connected),
      isYouTubeUploadAuthorized: vi.fn().mockResolvedValue(connected && hasUploadScope),
    } as unknown as GoogleOAuthService;
  }

  // Helper to create mock fetchFn
  function createMockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    return vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      return handler(url, init);
    }) as unknown as typeof fetch;
  }

  describe('Pre-flight File & Metadata Validation', () => {
    it('rejects if video file does not exist', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });
      const nonExistent = join(tempDir, 'does-not-exist.mp4');

      await expect(
        executor.execute('video-upload', {
          filePath: nonExistent,
          title: 'Test Video',
        }),
      ).rejects.toThrow(/Video file not found/i);
    });

    it('rejects if target path is a directory', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: tempDir,
          title: 'Test Video',
        }),
      ).rejects.toThrow(/not a regular file/i);
    });

    it('rejects 0-byte video files', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: emptyVideoPath,
          title: 'Empty Video',
        }),
      ).rejects.toThrow(/Video file is empty \(0 bytes\)/i);
    });

    it('rejects unsupported file formats (.txt, .exe, .pdf)', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: textFilePath,
          title: 'Notes Document',
        }),
      ).rejects.toThrow(/Unsupported video file format "\.txt"/i);
    });

    it('rejects missing or empty title', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: validVideoPath,
          title: '   ',
        }),
      ).rejects.toThrow(/Video title is required and cannot be empty/i);
    });

    it('rejects title exceeding 100 characters', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: validVideoPath,
          title: 'A'.repeat(101),
        }),
      ).rejects.toThrow(/exceeds maximum allowed length of 100 characters/i);
    });

    it('rejects description exceeding 5000 characters', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: validVideoPath,
          title: 'Valid Title',
          description: 'D'.repeat(5001),
        }),
      ).rejects.toThrow(/exceeds maximum allowed length of 5000 characters/i);
    });

    it('rejects invalid privacyStatus', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: validVideoPath,
          title: 'Valid Title',
          privacyStatus: 'confidential',
        }),
      ).rejects.toThrow(/Invalid privacyStatus "confidential"/i);
    });

    it('rejects tags exceeding 500 characters total', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: validVideoPath,
          title: 'Valid Title',
          tags: ['tag1'.repeat(40), 'tag2'.repeat(40), 'tag3'.repeat(40), 'tag4'.repeat(40)],
        }),
      ).rejects.toThrow(/tags total length exceeds maximum allowed length of 500 characters/i);
    });
  });

  describe('Authentication & Scope Verification', () => {
    it('throws when Google account is not connected', async () => {
      const mockOAuth = createMockOAuth({ connected: false });
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: validVideoPath,
          title: 'Demo',
        }),
      ).rejects.toThrow(/No Google account connected/i);
    });

    it('throws with actionable instructions when missing youtube.upload scope', async () => {
      const mockOAuth = createMockOAuth({ connected: true, hasUploadScope: false });
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: validVideoPath,
          title: 'Demo',
        }),
      ).rejects.toThrow(/Missing required YouTube upload permission/i);
    });
  });

  describe('Approval Binding & Tamper Detection', () => {
    it('aborts upload if file SHA-256 hash changes after approval was granted', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      const tamperedHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

      await expect(
        executor.execute('video-upload', {
          filePath: validVideoPath,
          title: 'Approved Video',
          fileSha256: tamperedHash,
        }),
      ).rejects.toThrow(/Tamper detection alert: File content at .* has changed since approval/i);
    });

    it('aborts upload if file size changes after approval was granted', async () => {
      const mockOAuth = createMockOAuth();
      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth });

      await expect(
        executor.execute('video-upload', {
          filePath: validVideoPath,
          title: 'Approved Video',
          fileSize: videoSize + 1024,
        }),
      ).rejects.toThrow(/Tamper detection alert: File size at .* has changed since approval/i);
    });

    it('proceeds with upload when approval hash and size match file on disk', async () => {
      const mockOAuth = createMockOAuth();
      const sessionUrl = 'https://upload.youtube.com/upload/session/mock-session-1?upload_id=safe-session-1';
      const videoId = 'test-vid-12345';

      const mockFetch = createMockFetch((url, init) => {
        // 1. Session status check before upload
        if (url.includes('mock-session-1') && init?.method === 'PUT' && init.headers && (init.headers as any)['Content-Range'] === `bytes */${videoSize}`) {
          return new Response(null, {
            status: 308,
            headers: { range: 'bytes=0-0' },
          });
        }
        // 2. Resumable upload initiation
        if (url.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
          return new Response(null, {
            status: 200,
            headers: { location: sessionUrl },
          });
        }
        // 3. Byte transfer
        if (url.includes('mock-session-1') && init?.method === 'PUT') {
          return new Response(JSON.stringify({ id: videoId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // 4. Post-upload verification
        if (url.includes('/youtube/v3/videos?part=snippet,status,processingDetails')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: videoId,
                  snippet: { title: 'Approved Video', channelId: 'UC_test_channel' },
                  status: { uploadStatus: 'uploaded', privacyStatus: 'private' },
                  processingDetails: { processingStatus: 'processing' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });

      const result = (await executor.execute('video-upload', {
        filePath: validVideoPath,
        title: 'Approved Video',
        fileSha256: videoSha256,
        fileSize: videoSize,
        privacyStatus: 'private',
      })) as any;

      expect(result.success).toBe(true);
      expect(result.videoId).toBe(videoId);
      expect(result.uploadStatus).toBe('uploaded');
      expect(result.processingStatus).toBe('processing');
      expect(result.fileSha256).toBe(videoSha256);
      expect(result.bytesUploaded).toBe(videoSize);
    });
  });

  describe('Resumable Upload Protocol & Verification', () => {
    it('executes full resumable upload protocol with correct headers and payload', async () => {
      const mockOAuth = createMockOAuth();
      const sessionUrl = 'https://upload.youtube.com/upload/session/mock-session-full?upload_id=full-token';
      const videoId = 'vid-full-987';
      let initiationHeaders: HeadersInit | undefined;
      let initiationBody: string | undefined;
      let uploadHeaders: HeadersInit | undefined;

      const mockFetch = createMockFetch((url, init) => {
        if (url.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
          initiationHeaders = init?.headers;
          initiationBody = init?.body as string;
          return new Response(null, {
            status: 200,
            headers: { location: sessionUrl },
          });
        }

        if (url.includes('mock-session-full')) {
          const contentRange = (init?.headers as any)?.['Content-Range'];
          if (contentRange === `bytes */${videoSize}`) {
            // Check status query
            return new Response(null, { status: 308, headers: {} });
          }
          uploadHeaders = init?.headers;
          return new Response(JSON.stringify({ id: videoId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.includes('/youtube/v3/videos?part=')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: videoId,
                  snippet: { title: 'Product Launch Keynote', channelId: 'UC12345' },
                  status: { uploadStatus: 'uploaded', privacyStatus: 'unlisted' },
                  processingDetails: { processingStatus: 'succeeded' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response('Not Found', { status: 404 });
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });

      const result = (await executor.execute('video-upload', {
        filePath: validVideoPath,
        title: 'Product Launch Keynote',
        description: 'Official release keynote for 2026',
        tags: ['keynote', 'product', 'release'],
        privacyStatus: 'unlisted',
        categoryId: '28', // Science & Tech
      })) as any;

      // Check initiation request
      expect(initiationHeaders).toBeDefined();
      expect((initiationHeaders as any)['Authorization']).toBe(`Bearer ${MOCK_ACCESS_TOKEN}`);
      expect((initiationHeaders as any)['X-Upload-Content-Type']).toBe('video/mp4');
      expect((initiationHeaders as any)['X-Upload-Content-Length']).toBe(String(videoSize));

      const parsedBody = JSON.parse(initiationBody!);
      expect(parsedBody.snippet.title).toBe('Product Launch Keynote');
      expect(parsedBody.snippet.description).toBe('Official release keynote for 2026');
      expect(parsedBody.snippet.tags).toEqual(['keynote', 'product', 'release']);
      expect(parsedBody.snippet.categoryId).toBe('28');
      expect(parsedBody.status.privacyStatus).toBe('unlisted');
      expect(parsedBody.status.selfDeclaredMadeForKids).toBe(false);

      // Check upload transfer request
      expect(uploadHeaders).toBeDefined();
      expect((uploadHeaders as any)['Content-Range']).toBe(`bytes 0-${videoSize - 1}/${videoSize}`);
      expect((uploadHeaders as any)['Content-Length']).toBe(String(videoSize));
      expect((uploadHeaders as any)['Content-Type']).toBe('video/mp4');

      // Check verified result
      expect(result.videoId).toBe(videoId);
      expect(result.videoUrl).toBe(`https://www.youtube.com/watch?v=${videoId}`);
      expect(result.title).toBe('Product Launch Keynote');
      expect(result.privacyStatus).toBe('unlisted');
      expect(result.uploadStatus).toBe('uploaded');
      expect(result.processingStatus).toBe('succeeded');
    });

    it('recovers from interruption and resumes upload via HTTP 308 Range header', async () => {
      const mockOAuth = createMockOAuth();
      const sessionUrl = 'https://upload.youtube.com/upload/session/mock-session-resume?upload_id=resume-token';
      const videoId = 'vid-resumed-321';
      let chunkAttempt = 0;
      let resumeStartOffset = -1;

      const halfSize = Math.floor(videoSize / 2);

      const mockFetch = createMockFetch((url, init) => {
        if (url.includes('uploadType=resumable')) {
          return new Response(null, { status: 200, headers: { location: sessionUrl } });
        }

        if (url.includes('mock-session-resume')) {
          const contentRange = (init?.headers as any)?.['Content-Range'];

          // Status query
          if (contentRange === `bytes */${videoSize}`) {
            if (chunkAttempt === 0) {
              return new Response(null, { status: 308 });
            }
            return new Response(null, {
              status: 308,
              headers: { range: `bytes=0-${halfSize - 1}` },
            });
          }

          // First chunk attempt: simulates partial upload interruption
          chunkAttempt++;
          if (chunkAttempt === 1) {
            return new Response(null, {
              status: 308,
              headers: { range: `bytes=0-${halfSize - 1}` },
            });
          }

          // Second chunk attempt: resumes remainder
          resumeStartOffset = halfSize;
          expect(contentRange).toBe(`bytes ${halfSize}-${videoSize - 1}/${videoSize}`);
          return new Response(JSON.stringify({ id: videoId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.includes('/youtube/v3/videos?part=')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: videoId,
                  snippet: { title: 'Resumed Upload', channelId: 'UC999' },
                  status: { uploadStatus: 'uploaded', privacyStatus: 'private' },
                  processingDetails: { processingStatus: 'processing' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response('Not Found', { status: 404 });
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });

      const result = (await executor.execute('video-upload', {
        filePath: validVideoPath,
        title: 'Resumed Upload',
      })) as any;

      expect(resumeStartOffset).toBe(halfSize);
      expect(result.videoId).toBe(videoId);
      expect(result.bytesUploaded).toBe(videoSize);
    });

    it('prevents duplicate upload when upload session already completed remotely', async () => {
      const mockOAuth = createMockOAuth();
      const sessionUrl = 'https://upload.youtube.com/upload/session/mock-session-dup?upload_id=dup-token';
      const existingVideoId = 'existing-vid-already-uploaded';
      let putBytesCalled = false;

      const mockFetch = createMockFetch((url, init) => {
        if (url.includes('uploadType=resumable')) {
          return new Response(null, { status: 200, headers: { location: sessionUrl } });
        }

        if (url.includes('mock-session-dup')) {
          const contentRange = (init?.headers as any)?.['Content-Range'];
          // When querying status, session already completed (HTTP 200)
          if (contentRange === `bytes */${videoSize}`) {
            return new Response(JSON.stringify({ id: existingVideoId }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          putBytesCalled = true;
          return new Response('Unexpected byte PUT', { status: 500 });
        }

        if (url.includes('/youtube/v3/videos?part=')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: existingVideoId,
                  snippet: { title: 'Duplicate Safe Upload', channelId: 'UCdup' },
                  status: { uploadStatus: 'uploaded', privacyStatus: 'private' },
                  processingDetails: { processingStatus: 'succeeded' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response('Not Found', { status: 404 });
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });

      const result = (await executor.execute('video-upload', {
        filePath: validVideoPath,
        title: 'Duplicate Safe Upload',
      })) as any;

      expect(putBytesCalled).toBe(false);
      expect(result.videoId).toBe(existingVideoId);
      expect(result.processingStatus).toBe('succeeded');
    });

    it('retries on transient 5xx server errors and succeeds', async () => {
      const mockOAuth = createMockOAuth();
      const sessionUrl = 'https://upload.youtube.com/upload/session/mock-session-retry?upload_id=retry-token';
      const videoId = 'vid-recovered-503';
      let putAttempts = 0;

      const mockFetch = createMockFetch((url, init) => {
        if (url.includes('uploadType=resumable')) {
          return new Response(null, { status: 200, headers: { location: sessionUrl } });
        }

        if (url.includes('mock-session-retry')) {
          const contentRange = (init?.headers as any)?.['Content-Range'];
          if (contentRange === `bytes */${videoSize}`) {
            return new Response(null, { status: 308 });
          }

          putAttempts++;
          if (putAttempts === 1) {
            // First attempt fails with 503
            return new Response('Service Unavailable', { status: 503 });
          }
          // Second attempt succeeds
          return new Response(JSON.stringify({ id: videoId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.includes('/youtube/v3/videos?part=')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: videoId,
                  snippet: { title: '503 Recovered Video', channelId: 'UCretry' },
                  status: { uploadStatus: 'uploaded', privacyStatus: 'private' },
                  processingDetails: { processingStatus: 'processing' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response('Not Found', { status: 404 });
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });

      const result = (await executor.execute('video-upload', {
        filePath: validVideoPath,
        title: '503 Recovered Video',
      })) as any;

      expect(putAttempts).toBe(2);
      expect(result.videoId).toBe(videoId);
    });
  });

  describe('Error Discrimination, Quota Cost, and Secret Redaction', () => {
    it('discriminates 403 quotaExceeded error with explicit 1,600 units cost guidance', async () => {
      const mockOAuth = createMockOAuth();
      const mockFetch = createMockFetch((url) => {
        if (url.includes('uploadType=resumable')) {
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
        }
        return new Response('Not Found', { status: 404 });
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });

      await expect(
        executor.execute('video-upload', {
          filePath: validVideoPath,
          title: 'Quota Exceeded Test',
        }),
      ).rejects.toThrow(/YouTube API quota exceeded: Video uploads consume 1,600 quota units/i);
    });

    it('redacts sensitive upload_id and bearer token from error messages', async () => {
      const mockOAuth = createMockOAuth();
      const sessionUrl = 'https://upload.youtube.com/upload/session/leak-test?upload_id=mock-test-upload-key-999';

      const mockFetch = createMockFetch((url) => {
        if (url.includes('uploadType=resumable')) {
          return new Response(null, { status: 200, headers: { location: sessionUrl } });
        }
        if (url.includes('leak-test')) {
          // Return non-quota 403 with session URL
          return new Response(
            JSON.stringify({
              error: {
                code: 403,
                message: `Forbidden on ${sessionUrl} with auth ${MOCK_ACCESS_TOKEN}`,
                errors: [{ reason: 'forbidden' }],
              },
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const executor = new YouTubeExecutor({ googleOAuth: mockOAuth, fetchFn: mockFetch });

      try {
        await executor.execute('video-upload', {
          filePath: validVideoPath,
          title: 'Redaction Test',
        });
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(MOCK_ACCESS_TOKEN);
        expect(err.message).not.toContain('super-secret-upload-key-999');
        expect(err.message).toContain('[REDACTED]');
      }

      // Explicit pattern scrubbing check for upload_id
      const rawErrorWithUploadId = 'Upload failed at https://upload.youtube.com/upload/session?upload_id=leak-token-123456';
      const scrubbed = sanitizeErrorString(rawErrorWithUploadId);
      expect(scrubbed).toBe('Upload failed at https://upload.youtube.com/upload/session?upload_id=[REDACTED_UPLOAD_ID]');
    });
  });

  describe('StandardStepExecutor & Workflow Engine Approval Integration', () => {
    it('dispatches bridge "youtube", action "video-upload" to YouTubeExecutor via StandardStepExecutor', async () => {
      const mockOAuth = createMockOAuth();
      const sessionUrl = 'https://upload.youtube.com/upload/session/disp-session?upload_id=disp-123';
      const videoId = 'vid-dispatcher-check';

      const mockFetch = createMockFetch((url, init) => {
        if (url.includes('uploadType=resumable')) {
          return new Response(null, { status: 200, headers: { location: sessionUrl } });
        }
        if (url.includes('disp-session')) {
          const contentRange = (init?.headers as any)?.['Content-Range'];
          if (contentRange === `bytes */${videoSize}`) {
            return new Response(null, { status: 308 });
          }
          return new Response(JSON.stringify({ id: videoId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/youtube/v3/videos?part=')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: videoId,
                  snippet: { title: 'Dispatcher Video', channelId: 'UCdisp' },
                  status: { uploadStatus: 'uploaded', privacyStatus: 'private' },
                  processingDetails: { processingStatus: 'processing' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const youtubeExecutor = new YouTubeExecutor({
        googleOAuth: mockOAuth,
        fetchFn: mockFetch,
      });

      const stepExecutor = new StandardStepExecutor({
        youtubeExecutor,
      });

      const result = (await stepExecutor.execute(
        {
          id: 'step-upload',
          name: 'Upload Step',
          bridge: 'youtube',
          action: 'video-upload',
          inputs: {
            filePath: validVideoPath,
            title: 'Dispatcher Video',
          },
        },
        {
          filePath: validVideoPath,
          title: 'Dispatcher Video',
        },
      )) as any;

      expect(result.videoId).toBe(videoId);
      expect(result.videoUrl).toContain(videoId);
    });

    it('requires approval checkpoint for video-upload in WorkflowEngine and resumes only with matching approved inputs', async () => {
      const mockOAuth = createMockOAuth();
      const sessionUrl = 'https://upload.youtube.com/upload/session/wf-session?upload_id=wf-123';
      const videoId = 'vid-wf-approved';

      const mockFetch = createMockFetch((url, init) => {
        if (url.includes('uploadType=resumable')) {
          return new Response(null, { status: 200, headers: { location: sessionUrl } });
        }
        if (url.includes('wf-session')) {
          const contentRange = (init?.headers as any)?.['Content-Range'];
          if (contentRange === `bytes */${videoSize}`) {
            return new Response(null, { status: 308 });
          }
          return new Response(JSON.stringify({ id: videoId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/youtube/v3/videos?part=')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: videoId,
                  snippet: { title: 'Workflow Video', channelId: 'UCwf' },
                  status: { uploadStatus: 'uploaded', privacyStatus: 'private' },
                  processingDetails: { processingStatus: 'succeeded' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      // Load registry with real YouTube bridge manifest
      const registry = new BridgeRegistry(resolve(process.cwd(), 'bridges'));
      await registry.discover();

      const permissions = new PermissionManager();
      const youtubeExecutor = new YouTubeExecutor({
        googleOAuth: mockOAuth,
        fetchFn: mockFetch,
      });

      const stepExecutor = new StandardStepExecutor({
        youtubeExecutor,
      });

      const engine = new WorkflowEngine(registry, permissions, stepExecutor);

      const workflow: WorkflowDefinition = {
        id: 'youtube-upload-pipeline',
        name: 'YouTube Upload Pipeline',
        description: 'Upload video after human verification',
        steps: [
          {
            id: 'upload-step',
            name: 'Upload Video',
            bridge: 'youtube',
            action: 'video-upload',
            inputs: {
              filePath: validVideoPath,
              title: 'Workflow Video',
              fileSha256: videoSha256,
              fileSize: videoSize,
              privacyStatus: 'private',
            },
          },
        ],
        createdAt: new Date().toISOString(),
      };

      // 1. Initial attempt -> MUST pause for approval because video-upload is permissionLevel: 'publish'
      let run = engine.createRun(workflow);
      run = await engine.executeRun(workflow, run);

      expect(run.status).toBe('paused_for_approval');
      expect(run.steps[0].status).toBe('waiting-approval');

      // 2. Grant approval bound to exact file hash and inputs
      permissions.recordApproval(
        'youtube',
        'video-upload',
        'publish',
        'developer',
        'Approved after reviewing video content and SHA-256 integrity',
        {
          filePath: validVideoPath,
          title: 'Workflow Video',
          fileSha256: videoSha256,
          fileSize: videoSize,
          privacyStatus: 'private',
        },
      );

      // 3. Resume workflow -> should complete successfully
      run = await engine.executeRun(workflow, run);

      expect(run.status).toBe('completed');
      expect(run.steps[0].status).toBe('completed');
      expect((run.steps[0].output as any).videoId).toBe(videoId);
      expect((run.steps[0].output as any).uploadStatus).toBe('uploaded');
    });

    it('automatically binds approval checkpoint to fileSha256 and fileSize when omitted from step definition, and aborts if file is tampered', async () => {
      const mockOAuth = createMockOAuth();
      const sessionUrl = 'https://upload.youtube.com/upload/session/tamper-session?upload_id=t-123';
      const videoId = 'vid-tamper-test';

      const mockFetch = createMockFetch((url) => {
        if (url.includes('uploadType=resumable')) {
          return new Response(null, { status: 200, headers: { location: sessionUrl } });
        }
        return new Response(JSON.stringify({ id: videoId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const registry = new BridgeRegistry(resolve(process.cwd(), 'bridges'));
      await registry.discover();

      const permissions = new PermissionManager();
      const youtubeExecutor = new YouTubeExecutor({
        googleOAuth: mockOAuth,
        fetchFn: mockFetch,
      });

      const stepExecutor = new StandardStepExecutor({
        youtubeExecutor,
      });

      const engine = new WorkflowEngine(registry, permissions, stepExecutor);

      // Workflow definition without pre-computed fileSha256 or fileSize
      const workflow: WorkflowDefinition = {
        id: 'auto-hash-pipeline',
        name: 'Auto Hash Pipeline',
        description: 'Verifies hash and size are automatically computed and bound to approval',
        steps: [
          {
            id: 'upload-step',
            name: 'Upload Video',
            bridge: 'youtube',
            action: 'video-upload',
            inputs: {
              filePath: validVideoPath,
              title: 'Auto Hash Title',
            },
          },
        ],
        createdAt: new Date().toISOString(),
      };

      // 1. Initial execution halts with paused_for_approval
      let run = engine.createRun(workflow);
      run = await engine.executeRun(workflow, run);

      expect(run.status).toBe('paused_for_approval');
      const checkpoint = run.pendingApproval!;
      expect(checkpoint).toBeDefined();

      // Verify approval inputs cover ALL required fields:
      expect(checkpoint.inputs.filePath).toBe(validVideoPath);
      expect(checkpoint.inputs.title).toBe('Auto Hash Title');
      expect(checkpoint.inputs.fileSha256).toBe(videoSha256);
      expect(checkpoint.inputs.fileSize).toBe(videoSize);

      // 2. Approve with the exact checkpoint inputs
      permissions.recordApproval(
        checkpoint.provider,
        checkpoint.action,
        checkpoint.permissionLevel,
        'security-auditor',
        'Approved after reviewing automatic SHA-256 and file size',
        checkpoint.inputs,
      );

      // 3. Simulate tamper: modify the file on disk after approval
      writeFileSync(validVideoPath, Buffer.from('TAMPERED-AFTER-APPROVAL-CONTENT'));

      // 4. Layer 1 Defense (Permission Manager): Resumption refuses to execute under prior approval
      // because the new file hash does not match the approved hash!
      const tamperedRun = await engine.executeRun(workflow, run);
      expect(tamperedRun.status).toBe('paused_for_approval');
      expect(tamperedRun.pendingApproval!.inputs.fileSha256).not.toBe(videoSha256);

      // 5. Layer 2 Defense (Executor): If approved inputs are passed against the tampered disk file,
      // prepareUpload rejects with a tamper detection alert
      await expect(
        stepExecutor.execute(workflow.steps[0], {
          filePath: validVideoPath,
          title: 'Auto Hash Title',
          fileSha256: videoSha256,
          fileSize: videoSize,
        }),
      ).rejects.toThrow(/Tamper detection alert: File content at .* has changed since approval/i);
    });
  });
});
