import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  GoogleOAuthService,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
} from '../auth/google-oauth.js';
import { sanitizeErrorString, redactObject } from '../auth/redact.js';

export const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
export const YOUTUBE_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/youtube/v3';

export const VIDEO_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/x-m4v',
  '.3gp': 'video/3gpp',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
};

export interface YouTubeChannelInfo {
  id: string;
  title: string;
  description: string;
  customUrl: string;
  publishedAt: string;
  thumbnails: Record<string, { url: string; width?: number; height?: number }>;
  country?: string;
  uploadsPlaylistId?: string;
  viewCount: number;
  subscriberCount: number;
  hiddenSubscriberCount?: boolean;
  videoCount: number;
  privacyStatus?: string;
}

export interface YouTubeVideoItem {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnails: Record<string, { url: string; width?: number; height?: number }>;
  channelId: string;
  channelTitle: string;
  playlistId: string;
  position?: number;
  videoUrl: string;
}

export interface ChannelInspectResult {
  hasChannel: boolean;
  channel: YouTubeChannelInfo | null;
  message: string;
}

export interface ChannelMetadataResult {
  found: boolean;
  channel: YouTubeChannelInfo | null;
  message: string;
}

export interface VideoListResult {
  videos: YouTubeVideoItem[];
  totalResults: number;
  resultsPerPage: number;
  nextPageToken?: string;
  prevPageToken?: string;
  message: string;
}

export interface VideoUploadInputs {
  filePath: string;
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: 'private' | 'unlisted' | 'public';
  defaultLanguage?: string;
  fileSha256?: string;
  fileSize?: number;
}

export interface PreparedUploadMetadata {
  filePath: string;
  fileSize: number;
  fileSha256: string;
  mimeType: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  defaultLanguage: string;
}

export interface VideoUploadResult {
  success: boolean;
  videoId: string;
  videoUrl: string;
  title: string;
  privacyStatus: string;
  uploadStatus: string;
  processingStatus: 'processing' | 'succeeded' | 'failed' | 'terminated' | 'unknown';
  channelId: string;
  fileSha256: string;
  bytesUploaded: number;
  message: string;
}

export interface YouTubeExecutorOptions {
  googleOAuth?: GoogleOAuthService;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  uploadBaseUrl?: string;
}

/**
 * Real YouTube Data API v3 Executor for AgentForge.
 * Supports read-only actions (channel-inspect, channel-metadata, video-list)
 * and publishing action (video-upload) with resumable uploading,
 * tamper detection, and post-upload verification.
 */
export class YouTubeExecutor {
  private googleOAuth: GoogleOAuthService;
  private fetchFn: typeof fetch;
  private baseUrl: string;
  private uploadBaseUrl: string;

  constructor(options: YouTubeExecutorOptions = {}) {
    this.googleOAuth = options.googleOAuth || new GoogleOAuthService();
    this.fetchFn = options.fetchFn || fetch;
    this.baseUrl = options.baseUrl || YOUTUBE_API_BASE_URL;
    this.uploadBaseUrl = options.uploadBaseUrl || YOUTUBE_UPLOAD_BASE_URL;
  }

  /**
   * Action dispatcher for the YouTube bridge.
   */
  async execute(action: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    switch (action) {
      case 'channel-inspect':
        return this.inspectChannel();

      case 'channel-metadata':
        return this.getChannelMetadata(inputs);

      case 'video-list':
        return this.listVideos(inputs);

      case 'video-upload':
        return this.uploadVideo(inputs);

      default:
        throw new Error(`Unsupported or unimplemented action on YouTube bridge: "${action}"`);
    }
  }

  /**
   * Ensure user is authenticated and has granted the required youtube.readonly scope.
   * Returns a valid, refreshed access token.
   */
  async ensureAuthorizedToken(): Promise<string> {
    const status = await this.googleOAuth.getStatus();
    if (!status.accountConnected) {
      throw new Error(
        'No Google account connected. Please authenticate with "agentforge auth youtube" or via the Manager dashboard.',
      );
    }

    const hasScope = await this.googleOAuth.hasScopes([YOUTUBE_READONLY_SCOPE]);
    if (!hasScope) {
      throw new Error(
        `Missing required YouTube permission. The scope "${YOUTUBE_READONLY_SCOPE}" has not been granted for this account. Run "agentforge auth youtube" or re-authenticate in the Manager to authorize YouTube read-only access.`,
      );
    }

    return this.googleOAuth.getValidAccessToken();
  }

  /**
   * Ensure user is authenticated and has granted the required youtube.upload scope.
   * Returns a valid, refreshed access token.
   */
  async ensureUploadAuthorizedToken(): Promise<string> {
    const status = await this.googleOAuth.getStatus();
    if (!status.accountConnected) {
      throw new Error(
        'No Google account connected. Please authenticate with "agentforge auth youtube --upload" or via the Manager dashboard.',
      );
    }

    const hasScope = await this.googleOAuth.hasScopes([YOUTUBE_UPLOAD_SCOPE]);
    if (!hasScope) {
      throw new Error(
        `Missing required YouTube upload permission. The scope "${YOUTUBE_UPLOAD_SCOPE}" has not been granted for this account. Run "agentforge auth youtube --upload" to authorize video publishing.`,
      );
    }

    return this.googleOAuth.getValidAccessToken();
  }

  /**
   * Inspect the authenticated user's YouTube channel.
   * Uses endpoint: GET /channels?part=snippet,contentDetails,statistics,status&mine=true
   */
  async inspectChannel(): Promise<ChannelInspectResult> {
    const token = await this.ensureAuthorizedToken();
    const url = `${this.baseUrl}/channels?part=snippet,contentDetails,statistics,status&mine=true`;

    const data = await this.fetchJson(url, token);

    if (!Array.isArray(data.items) || data.items.length === 0) {
      return {
        hasChannel: false,
        channel: null,
        message: 'No YouTube channel found for the authenticated Google account. A YouTube channel must be created on YouTube first.',
      };
    }

    const item = data.items[0];
    const channel = this.mapChannelItem(item);

    return {
      hasChannel: true,
      channel,
      message: `YouTube channel "${channel.title || channel.id}" retrieved successfully.`,
    };
  }

  /**
   * Retrieve channel metadata for the authenticated user, or for a specific channel by ID or handle.
   * Uses endpoint: GET /channels?part=snippet,contentDetails,statistics&...
   */
  async getChannelMetadata(inputs: { channelId?: unknown; forHandle?: unknown } = {}): Promise<ChannelMetadataResult> {
    const token = await this.ensureAuthorizedToken();

    let queryParam = 'mine=true';
    if (typeof inputs.channelId === 'string' && inputs.channelId.trim()) {
      queryParam = `id=${encodeURIComponent(inputs.channelId.trim())}`;
    } else if (typeof inputs.forHandle === 'string' && inputs.forHandle.trim()) {
      const handle = inputs.forHandle.trim().replace(/^@/, '');
      queryParam = `forHandle=${encodeURIComponent(handle)}`;
    }

    const url = `${this.baseUrl}/channels?part=snippet,contentDetails,statistics&${queryParam}`;
    const data = await this.fetchJson(url, token);

    if (!Array.isArray(data.items) || data.items.length === 0) {
      return {
        found: false,
        channel: null,
        message: 'No YouTube channel found matching the specified parameters.',
      };
    }

    const channel = this.mapChannelItem(data.items[0]);
    return {
      found: true,
      channel,
      message: `Metadata for channel "${channel.title || channel.id}" retrieved successfully.`,
    };
  }

  /**
   * List videos from the user's uploads playlist or a specified playlist.
   * Uses endpoint: GET /playlistItems?part=snippet,contentDetails&playlistId=...
   * Note: playlistItems costs only 1 quota unit, compared to 100 quota units for search.list.
   */
  async listVideos(inputs: {
    maxResults?: unknown;
    pageToken?: unknown;
    playlistId?: unknown;
  } = {}): Promise<VideoListResult> {
    const token = await this.ensureAuthorizedToken();

    let playlistId = typeof inputs.playlistId === 'string' ? inputs.playlistId.trim() : '';

    // If no playlistId specified, resolve user's uploads playlist from channel details
    if (!playlistId) {
      const inspect = await this.inspectChannel();
      if (!inspect.hasChannel || !inspect.channel) {
        return {
          videos: [],
          totalResults: 0,
          resultsPerPage: 0,
          message: 'No YouTube channel found for the authenticated Google account.',
        };
      }
      if (!inspect.channel.uploadsPlaylistId) {
        return {
          videos: [],
          totalResults: 0,
          resultsPerPage: 0,
          message: 'No uploads playlist found for this YouTube channel.',
        };
      }
      playlistId = inspect.channel.uploadsPlaylistId;
    }

    const maxResults = Math.min(Math.max(1, typeof inputs.maxResults === 'number' ? inputs.maxResults : 10), 50);
    const pageTokenParam =
      typeof inputs.pageToken === 'string' && inputs.pageToken.trim()
        ? `&pageToken=${encodeURIComponent(inputs.pageToken.trim())}`
        : '';

    const url = `${this.baseUrl}/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(
      playlistId,
    )}&maxResults=${maxResults}${pageTokenParam}`;

    const data = await this.fetchJson(url, token);

    if (!Array.isArray(data.items) || data.items.length === 0) {
      return {
        videos: [],
        totalResults: 0,
        resultsPerPage: 0,
        message: 'No videos found in the playlist.',
      };
    }

    const videos: YouTubeVideoItem[] = data.items.map((item: any) => {
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '';
      return {
        videoId,
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || '',
        thumbnails: item.snippet?.thumbnails || {},
        channelId: item.snippet?.channelId || '',
        channelTitle: item.snippet?.channelTitle || '',
        playlistId: item.snippet?.playlistId || playlistId,
        position: typeof item.snippet?.position === 'number' ? item.snippet.position : undefined,
        videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : '',
      };
    });

    return {
      videos,
      totalResults: data.pageInfo?.totalResults ?? videos.length,
      resultsPerPage: data.pageInfo?.resultsPerPage ?? videos.length,
      nextPageToken: data.nextPageToken,
      prevPageToken: data.prevPageToken,
      message: `Retrieved ${videos.length} videos from playlist.`,
    };
  }

  /**
   * Pre-flight validation and normalization of upload inputs.
   * Computes SHA-256 hash, verifies file readability, and ensures tamper-proofing.
   */
  async prepareUpload(inputs: Record<string, unknown>): Promise<PreparedUploadMetadata> {
    const rawFilePath = inputs.filePath;
    if (typeof rawFilePath !== 'string' || !rawFilePath.trim()) {
      throw new Error('Video filePath is required and must be a non-empty string path.');
    }
    const filePath = rawFilePath.trim();

    if (!existsSync(filePath)) {
      throw new Error(`Video file not found: "${filePath}"`);
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`Target path is not a regular file: "${filePath}"`);
    }

    if (fileStat.size <= 0) {
      throw new Error(`Video file is empty (0 bytes): "${filePath}"`);
    }

    const ext = extname(filePath).toLowerCase();
    if (!VIDEO_MIME_TYPES[ext]) {
      const allowed = Object.keys(VIDEO_MIME_TYPES).join(', ');
      throw new Error(`Unsupported video file format "${ext}". Supported formats: ${allowed}`);
    }
    const mimeType = VIDEO_MIME_TYPES[ext];

    // Read and compute SHA-256
    const fileBuffer = await readFile(filePath);
    const actualSha256 = createHash('sha256').update(fileBuffer).digest('hex');

    // Tamper detection: verify against expected hash or size if specified during approval
    if (typeof inputs.fileSha256 === 'string' && inputs.fileSha256.trim()) {
      if (inputs.fileSha256.trim().toLowerCase() !== actualSha256.toLowerCase()) {
        throw new Error(
          `Tamper detection alert: File content at "${filePath}" has changed since approval (hash mismatch). Upload aborted.`,
        );
      }
    }

    if (typeof inputs.fileSize === 'number') {
      if (inputs.fileSize !== fileStat.size) {
        throw new Error(
          `Tamper detection alert: File size at "${filePath}" has changed since approval (expected ${inputs.fileSize} bytes, actual ${fileStat.size} bytes). Upload aborted.`,
        );
      }
    }

    // Title validation
    const rawTitle = inputs.title;
    if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
      throw new Error('Video title is required and cannot be empty.');
    }
    const title = rawTitle.trim();
    if (title.length > 100) {
      throw new Error(`Video title exceeds maximum allowed length of 100 characters (got ${title.length}).`);
    }

    // Description validation
    let description = '';
    if (typeof inputs.description === 'string') {
      description = inputs.description.trim();
      if (description.length > 5000) {
        throw new Error(`Video description exceeds maximum allowed length of 5000 characters (got ${description.length}).`);
      }
    }

    // Privacy Status validation
    let privacyStatus: 'private' | 'unlisted' | 'public' = 'private';
    if (typeof inputs.privacyStatus === 'string' && inputs.privacyStatus.trim()) {
      const ps = inputs.privacyStatus.trim().toLowerCase();
      if (ps !== 'private' && ps !== 'unlisted' && ps !== 'public') {
        throw new Error(`Invalid privacyStatus "${inputs.privacyStatus}". Allowed values: 'private', 'unlisted', 'public'.`);
      }
      privacyStatus = ps;
    }

    // Tags validation
    let tags: string[] = [];
    if (Array.isArray(inputs.tags)) {
      tags = inputs.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map(t => t.trim());
      const totalTagLength = tags.join(',').length;
      if (totalTagLength > 500) {
        throw new Error(`Video tags total length exceeds maximum allowed length of 500 characters (got ${totalTagLength}).`);
      }
    }

    const categoryId = typeof inputs.categoryId === 'string' && inputs.categoryId.trim() ? inputs.categoryId.trim() : '22';
    const defaultLanguage = typeof inputs.defaultLanguage === 'string' && inputs.defaultLanguage.trim() ? inputs.defaultLanguage.trim() : 'en';

    return {
      filePath,
      fileSize: fileStat.size,
      fileSha256: actualSha256,
      mimeType,
      title,
      description,
      tags,
      categoryId,
      privacyStatus,
      defaultLanguage,
    };
  }

  /**
   * Initiate a resumable upload session with YouTube Data API v3.
   * Returns the session URL (location header).
   */
  async initiateResumableUpload(token: string, metadata: PreparedUploadMetadata): Promise<string> {
    const url = `${this.uploadBaseUrl}/videos?uploadType=resumable&part=snippet,status`;

    const body = {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId,
        defaultLanguage: metadata.defaultLanguage,
      },
      status: {
        privacyStatus: metadata.privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    };

    let resp: Response;
    try {
      resp = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(metadata.fileSize),
          'X-Upload-Content-Type': metadata.mimeType,
        },
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      const msg = sanitizeErrorString((err as Error).message, [token]);
      throw new Error(`Failed to initiate YouTube resumable upload session: ${msg}`);
    }

    if (!resp.ok) {
      await this.handleApiError(resp, token);
    }

    const sessionUri = resp.headers.get('location');
    if (!sessionUri) {
      throw new Error('YouTube resumable upload session initiation succeeded but returned no session Location header.');
    }

    return sessionUri;
  }

  /**
   * Check status of a resumable upload session (queries uploaded byte range).
   * Prevents duplicate uploads if the upload already completed remotely.
   */
  async checkUploadSessionStatus(
    sessionUri: string,
    fileSize: number,
    token?: string,
  ): Promise<{ completed: boolean; bytesUploaded: number; video?: any }> {
    try {
      const headers: Record<string, string> = {
        'Content-Length': '0',
        'Content-Range': `bytes */${fileSize}`,
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const resp = await this.fetchFn(sessionUri, {
        method: 'PUT',
        headers,
      });

      if (resp.status === 200 || resp.status === 201) {
        // Upload already finished
        const video = await resp.json().catch(() => null);
        return { completed: true, bytesUploaded: fileSize, video };
      }

      if (resp.status === 308) {
        const range = resp.headers.get('range');
        if (range) {
          const match = range.match(/bytes=(\d+)-(\d+)/);
          if (match) {
            const lastByte = parseInt(match[2], 10);
            return { completed: false, bytesUploaded: lastByte + 1 };
          }
        }
        return { completed: false, bytesUploaded: 0 };
      }

      return { completed: false, bytesUploaded: 0 };
    } catch {
      return { completed: false, bytesUploaded: 0 };
    }
  }

  /**
   * Upload video bytes to the resumable session URL with retry, interruption recovery,
   * and duplicate upload prevention.
   */
  async transferBytes(
    sessionUri: string,
    fileBuffer: Buffer,
    fileSize: number,
    mimeType: string,
    token: string,
  ): Promise<any> {
    // 1. Check if session already completed
    const initialStatus = await this.checkUploadSessionStatus(sessionUri, fileSize, token);
    if (initialStatus.completed && initialStatus.video) {
      return initialStatus.video;
    }

    let startOffset = initialStatus.bytesUploaded;
    const maxAttempts = 3;
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      const chunkBuffer = fileBuffer.subarray(startOffset);
      const endOffset = fileSize - 1;

      try {
        const resp = await this.fetchFn(sessionUri, {
          method: 'PUT',
          headers: {
            'Content-Length': String(chunkBuffer.length),
            'Content-Range': `bytes ${startOffset}-${endOffset}/${fileSize}`,
            'Content-Type': mimeType,
          },
          body: new Uint8Array(chunkBuffer),
        });

        if (resp.status === 200 || resp.status === 201) {
          const text = await resp.text();
          try {
            return JSON.parse(text);
          } catch {
            throw new Error('YouTube upload completed but returned an invalid non-JSON video resource.');
          }
        }

        if (resp.status === 308) {
          // Incomplete chunk: query range
          const status = await this.checkUploadSessionStatus(sessionUri, fileSize, token);
          if (status.completed && status.video) {
            return status.video;
          }
          startOffset = status.bytesUploaded;
          continue;
        }

        await this.handleApiError(resp, token, sessionUri);
      } catch (err: unknown) {
        if (attempts >= maxAttempts) {
          const safeMsg = sanitizeErrorString((err as Error).message, [token, sessionUri]);
          throw new Error(`YouTube video chunk upload failed after ${maxAttempts} attempts: ${safeMsg}`);
        }

        // Query session status before retry to resume accurately
        const status = await this.checkUploadSessionStatus(sessionUri, fileSize, token);
        if (status.completed && status.video) {
          return status.video;
        }
        startOffset = status.bytesUploaded;

        // Exponential backoff
        await new Promise(r => setTimeout(r, attempts * 500));
      }
    }

    throw new Error('YouTube video upload failed: maximum transfer attempts exceeded.');
  }

  /**
   * Verify uploaded video via videos.list to distinguish upload completion from processing status.
   */
  async verifyUploadedVideo(
    videoId: string,
    token: string,
  ): Promise<{
    uploadStatus: string;
    processingStatus: 'processing' | 'succeeded' | 'failed' | 'terminated' | 'unknown';
    channelId: string;
    title: string;
    privacyStatus: string;
  }> {
    const url = `${this.baseUrl}/videos?part=snippet,status,processingDetails&id=${encodeURIComponent(videoId)}`;

    try {
      const resp = await this.fetchFn(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!resp.ok) {
        return {
          uploadStatus: 'uploaded',
          processingStatus: 'unknown',
          channelId: '',
          title: '',
          privacyStatus: '',
        };
      }

      const data = await resp.json();
      if (!Array.isArray(data.items) || data.items.length === 0) {
        return {
          uploadStatus: 'uploaded',
          processingStatus: 'unknown',
          channelId: '',
          title: '',
          privacyStatus: '',
        };
      }

      const video = data.items[0];
      const processingStatus = video.processingDetails?.processingStatus || 'processing';

      return {
        uploadStatus: video.status?.uploadStatus || 'uploaded',
        processingStatus: processingStatus,
        channelId: video.snippet?.channelId || '',
        title: video.snippet?.title || '',
        privacyStatus: video.status?.privacyStatus || 'private',
      };
    } catch {
      return {
        uploadStatus: 'uploaded',
        processingStatus: 'unknown',
        channelId: '',
        title: '',
        privacyStatus: '',
      };
    }
  }

  /**
   * Execute real video upload with resumable protocol, approval verification,
   * duplicate prevention, and post-upload verification.
   */
  async uploadVideo(inputs: Record<string, unknown>): Promise<VideoUploadResult> {
    const token = await this.ensureUploadAuthorizedToken();
    const metadata = await this.prepareUpload(inputs);
    const fileBuffer = await readFile(metadata.filePath);

    // 1. Initiate resumable upload session
    const sessionUri = await this.initiateResumableUpload(token, metadata);

    // 2. Transfer bytes to session URL (with resume and duplicate detection)
    const videoResource = await this.transferBytes(
      sessionUri,
      fileBuffer,
      metadata.fileSize,
      metadata.mimeType,
      token,
    );

    const videoId = videoResource?.id;
    if (!videoId || typeof videoId !== 'string') {
      throw new Error('YouTube API did not return a valid video ID upon upload completion.');
    }

    // 3. Post-upload verification
    const verified = await this.verifyUploadedVideo(videoId, token);

    return {
      success: true,
      videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: verified.title || metadata.title,
      privacyStatus: verified.privacyStatus || metadata.privacyStatus,
      uploadStatus: verified.uploadStatus,
      processingStatus: verified.processingStatus,
      channelId: verified.channelId || '',
      fileSha256: metadata.fileSha256,
      bytesUploaded: metadata.fileSize,
      message: `Video "${metadata.title}" uploaded successfully (${metadata.privacyStatus}). Video ID: ${videoId}. Processing status: ${verified.processingStatus}.`,
    };
  }

  /**
   * Helper to perform authenticated HTTP requests to the YouTube Data API.
   * Differentiates empty results from auth failure, quota exhaustion, missing scopes, and API enablement errors.
   */
  private async fetchJson(url: string, token: string): Promise<any> {
    let resp: Response;
    try {
      resp = await this.fetchFn(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
    } catch (err: unknown) {
      const msg = sanitizeErrorString((err as Error).message, [token]);
      throw new Error(`YouTube API network request failed: ${msg}`);
    }

    if (!resp.ok) {
      await this.handleApiError(resp, token);
    }

    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('YouTube API returned an invalid non-JSON response.');
    }
  }

  /**
   * Granular error analyzer that handles YouTube API error payloads and redacts secrets.
   */
  private async handleApiError(resp: Response, token: string, sessionUri?: string): Promise<never> {
    const status = resp.status;
    let errorText = '';
    try {
      errorText = await resp.text();
    } catch {
      // ignore
    }

    let parsedError: any = null;
    try {
      parsedError = JSON.parse(errorText);
    } catch {
      // raw text
    }

    const apiError = parsedError?.error;
    const firstReason = apiError?.errors?.[0]?.reason || '';
    const message = apiError?.message || errorText || `HTTP ${status}`;

    // 1. Authentication failure
    if (status === 401) {
      throw new Error(
        'Authentication failure: Invalid or expired Google access token. Please re-authenticate using "agentforge auth youtube".',
      );
    }

    // 2. Permission / API Restrictions / Quota Limits
    if (status === 403) {
      if (firstReason === 'quotaExceeded' || message.toLowerCase().includes('quota')) {
        throw new Error(
          'YouTube API quota exceeded: Video uploads consume 1,600 quota units. The daily YouTube Data API quota has been reached. Please retry after quota resets (midnight Pacific Time) or request a quota increase in Google Cloud Console.',
        );
      }

      if (
        firstReason === 'accessNotConfigured' ||
        message.includes('has not been used in project') ||
        message.includes('it is disabled')
      ) {
        throw new Error(
          'YouTube Data API v3 is not enabled in your Google Cloud project. Enable the YouTube Data API v3 at: https://console.cloud.google.com/apis/library/youtube.googleapis.com',
        );
      }

      if (firstReason === 'insufficientPermissions' || message.toLowerCase().includes('insufficient')) {
        if (sessionUri || message.toLowerCase().includes('upload')) {
          throw new Error(
            `Insufficient OAuth permissions: The scope "${YOUTUBE_UPLOAD_SCOPE}" is required. Run "agentforge auth youtube --upload" to grant video publishing permissions.`,
          );
        }
        throw new Error(
          `Insufficient OAuth permissions: The scope "${YOUTUBE_READONLY_SCOPE}" is required. Run "agentforge auth youtube" to grant read-only permissions.`,
        );
      }

      const safeMsg = sanitizeErrorString(message, [token, sessionUri]);
      throw new Error(`YouTube API access forbidden (HTTP 403): ${safeMsg}`);
    }

    // 3. Not Found
    if (status === 404) {
      const safeMsg = sanitizeErrorString(message, [token, sessionUri]);
      throw new Error(`YouTube resource not found (HTTP 404): ${safeMsg}`);
    }

    // 4. Fallback API error
    const safeMsg = sanitizeErrorString(message, [token, sessionUri]);
    throw new Error(`YouTube API error (HTTP ${status}): ${safeMsg}`);
  }

  /**
   * Helper to map a raw YouTube channel API resource into a sanitized YouTubeChannelInfo object.
   */
  private mapChannelItem(item: any): YouTubeChannelInfo {
    return {
      id: item.id || '',
      title: item.snippet?.title || '',
      description: item.snippet?.description || '',
      customUrl: item.snippet?.customUrl || '',
      publishedAt: item.snippet?.publishedAt || '',
      thumbnails: item.snippet?.thumbnails || {},
      country: item.snippet?.country,
      uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads,
      viewCount: Number(item.statistics?.viewCount || 0),
      subscriberCount: Number(item.statistics?.subscriberCount || 0),
      hiddenSubscriberCount: Boolean(item.statistics?.hiddenSubscriberCount),
      videoCount: Number(item.statistics?.videoCount || 0),
      privacyStatus: item.status?.privacyStatus,
    };
  }
}
