/**
 * X (Twitter) API v2 Integration Adapter for AgentForge
 * Provides full capabilities for Antigravity:
 * - Read & Research: me, get-user, get-tweet, search-tweets, get-timeline, get-mentions
 * - Engagement: like-tweet, unlike-tweet, retweet, follow-user, unfollow-user
 * - Content Creation: draft-tweet (offline preview), upload-media (images/videos), post-tweet, delete-tweet
 * Strict human-in-the-loop approval gates for external-write and publish tiers.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { BaseIntegrationAdapter, AdapterHealthResult, AdapterActionDefinition } from './base-adapter.js';
import { redactObject, sanitizeErrorString } from '../auth/redact.js';
import { CredentialStore } from '../auth/types.js';
import { getDefaultCredentialStore } from '../auth/credential-store.js';

export const X_API_BASE_URL = 'https://api.twitter.com';
export const X_UPLOAD_BASE_URL = 'https://upload.twitter.com';
export const MAX_TWEET_LENGTH = 280;
export const MAX_X_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_X_GIF_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_X_VIDEO_BYTES = 512 * 1024 * 1024; // 512 MB

const MEDIA_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

export interface XPollInput {
  options: string[];
  durationMinutes?: number;
}

export interface XAdapterOptions {
  fetchFn?: typeof fetch;
  apiBaseUrl?: string;
  uploadBaseUrl?: string;
  allowedBaseDir?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  credentialStore?: CredentialStore;
}

export class XAdapter extends BaseIntegrationAdapter {
  readonly name = 'x';
  readonly displayName = 'X (Twitter)';
  readonly description =
    'X (Twitter) API v2 integration: view tweets, research topics, inspect feed/videos, follow users, like/retweet, draft local previews, upload media, and post tweets.';
  readonly version = '1.0.0';
  readonly category = 'social-media';

  private customFetchFn?: typeof fetch;
  private apiBaseUrl: string;
  private uploadBaseUrl: string;
  private allowedBaseDir?: string;
  private maxRetries: number;
  private retryDelayMs: number;
  private store: CredentialStore;

  constructor(options: XAdapterOptions = {}) {
    super();
    this.customFetchFn = options.fetchFn;
    this.apiBaseUrl = (options.apiBaseUrl || X_API_BASE_URL).replace(/\/+$/, '');
    this.uploadBaseUrl = (options.uploadBaseUrl || X_UPLOAD_BASE_URL).replace(/\/+$/, '');
    this.allowedBaseDir = options.allowedBaseDir ? resolve(options.allowedBaseDir) : undefined;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    this.store = options.credentialStore || getDefaultCredentialStore();
  }

  getActions(): AdapterActionDefinition[] {
    return [
      {
        action: 'me',
        description: 'Verify token and fetch authenticated user profile via /2/users/me',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'get-user',
        description: 'Inspect public user profile by username or ID via /2/users',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'get-tweet',
        description: 'Inspect details of a specific tweet including metrics, author, and attached video/image media',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'search-tweets',
        description: 'Search recent tweets for keywords, hashtags, or research topics with media and metrics',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'get-timeline',
        description: 'Read the recent feed/timeline of tweets for an account',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'get-mentions',
        description: 'Read recent tweets mentioning the authenticated user',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'draft-tweet',
        description: 'Format, validate, and locally save a tweet preview JSON',
        permissionLevel: 'local-write',
        sideEffects: true,
        requiresApproval: false,
      },
      {
        action: 'like-tweet',
        description: 'Like a tweet on X via /2/users/:id/likes',
        permissionLevel: 'external-write',
        sideEffects: true,
        requiresApproval: true,
      },
      {
        action: 'unlike-tweet',
        description: 'Unlike a tweet on X via /2/users/:id/likes/:tweet_id',
        permissionLevel: 'external-write',
        sideEffects: true,
        requiresApproval: true,
      },
      {
        action: 'retweet',
        description: 'Retweet / Repost a tweet to your followers via /2/users/:id/retweets',
        permissionLevel: 'external-write',
        sideEffects: true,
        requiresApproval: true,
      },
      {
        action: 'follow-user',
        description: 'Follow an X user by username or numeric user ID',
        permissionLevel: 'external-write',
        sideEffects: true,
        requiresApproval: true,
      },
      {
        action: 'unfollow-user',
        description: 'Unfollow an X user by numeric user ID',
        permissionLevel: 'external-write',
        sideEffects: true,
        requiresApproval: true,
      },
      {
        action: 'upload-media',
        description: 'Upload a local image, GIF, or video to X and retrieve a media ID for attaching to tweets',
        permissionLevel: 'external-write',
        sideEffects: true,
        requiresApproval: true,
      },
      {
        action: 'post-tweet',
        description: 'Publish a live tweet to X via /2/tweets',
        permissionLevel: 'publish',
        sideEffects: true,
        requiresApproval: true,
      },
      {
        action: 'delete-tweet',
        description: 'Delete a tweet from X via DELETE /2/tweets/:id',
        permissionLevel: 'publish',
        sideEffects: true,
        requiresApproval: true,
      },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const token = await this.resolveAccessToken();
    if (!token) {
      return {
        healthy: false,
        status: 'unconfigured',
        message: 'X_ACCESS_TOKEN not configured (set environment variable or authenticate via Web Manager).',
        details: { configured: false },
      };
    }

    try {
      const profile = await this.executeMe(token);
      return {
        healthy: true,
        status: 'connected',
        message: `Connected to X as @${profile.username} (${profile.name}).`,
        details: {
          configured: true,
          username: profile.username,
          userId: profile.id,
          verified: profile.verified,
        },
      };
    } catch (err) {
      return {
        healthy: false,
        status: 'error',
        message: `X token validation failed: ${(err as Error)?.message || String(err)}`,
        details: { configured: true, error: (err as Error)?.message },
      };
    }
  }

  async execute(action: string, inputs: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    switch (action) {
      case 'me': {
        const token = await this.requireAccessToken();
        const profile = await this.executeMe(token);
        return redactObject(profile as unknown as Record<string, unknown>);
      }

      case 'get-user': {
        const token = await this.requireAccessToken();
        const username = typeof inputs.username === 'string' ? inputs.username.replace(/^@/, '').trim() : undefined;
        const userId = typeof inputs.userId === 'string' ? inputs.userId.trim() : undefined;
        if (!username && !userId) {
          throw new Error('Validation failed: either "username" or "userId" must be provided');
        }
        const user = await this.executeGetUser(token, { username, userId });
        return redactObject(user as unknown as Record<string, unknown>);
      }

      case 'get-tweet': {
        const token = await this.requireAccessToken();
        const tweetId = this.requireString(inputs.tweetId, 'tweetId');
        const tweet = await this.executeGetTweet(token, tweetId);
        return redactObject(tweet as unknown as Record<string, unknown>);
      }

      case 'search-tweets': {
        const token = await this.requireAccessToken();
        const query = this.requireString(inputs.query, 'query');
        const maxResults = typeof inputs.maxResults === 'number' ? Math.min(Math.max(inputs.maxResults, 10), 100) : 10;
        const results = await this.executeSearchTweets(token, query, maxResults);
        return redactObject(results as unknown as Record<string, unknown>);
      }

      case 'get-timeline': {
        const token = await this.requireAccessToken();
        const userId = typeof inputs.userId === 'string' ? inputs.userId.trim() : (await this.resolveUserId(token));
        const maxResults = typeof inputs.maxResults === 'number' ? Math.min(Math.max(inputs.maxResults, 5), 100) : 10;
        const timeline = await this.executeGetTimeline(token, userId, maxResults);
        return redactObject(timeline as unknown as Record<string, unknown>);
      }

      case 'get-mentions': {
        const token = await this.requireAccessToken();
        const userId = typeof inputs.userId === 'string' ? inputs.userId.trim() : (await this.resolveUserId(token));
        const maxResults = typeof inputs.maxResults === 'number' ? Math.min(Math.max(inputs.maxResults, 5), 100) : 10;
        const mentions = await this.executeGetMentions(token, userId, maxResults);
        return redactObject(mentions as unknown as Record<string, unknown>);
      }

      case 'draft-tweet': {
        const text = this.requireString(inputs.text, 'text');
        const inReplyToTweetId = typeof inputs.inReplyToTweetId === 'string' ? inputs.inReplyToTweetId.trim() : undefined;
        const mediaIds = Array.isArray(inputs.mediaIds) ? (inputs.mediaIds as string[]) : undefined;
        const poll = inputs.poll && typeof inputs.poll === 'object' ? (inputs.poll as XPollInput) : undefined;
        const outputPath = typeof inputs.outputPath === 'string' ? inputs.outputPath : undefined;

        const draft = await this.executeDraftTweet({ text, inReplyToTweetId, mediaIds, poll, outputPath });
        return redactObject(draft as unknown as Record<string, unknown>);
      }

      case 'like-tweet': {
        const token = await this.requireAccessToken();
        const userId = await this.resolveUserId(token);
        const tweetId = this.requireString(inputs.tweetId, 'tweetId');
        const result = await this.executeLikeTweet(token, userId, tweetId);
        return redactObject(result as unknown as Record<string, unknown>);
      }

      case 'unlike-tweet': {
        const token = await this.requireAccessToken();
        const userId = await this.resolveUserId(token);
        const tweetId = this.requireString(inputs.tweetId, 'tweetId');
        const result = await this.executeUnlikeTweet(token, userId, tweetId);
        return redactObject(result as unknown as Record<string, unknown>);
      }

      case 'retweet': {
        const token = await this.requireAccessToken();
        const userId = await this.resolveUserId(token);
        const tweetId = this.requireString(inputs.tweetId, 'tweetId');
        const result = await this.executeRetweet(token, userId, tweetId);
        return redactObject(result as unknown as Record<string, unknown>);
      }

      case 'follow-user': {
        const token = await this.requireAccessToken();
        const userId = await this.resolveUserId(token);
        let targetUserId = typeof inputs.targetUserId === 'string' ? inputs.targetUserId.trim() : undefined;
        if (!targetUserId && typeof inputs.targetUsername === 'string') {
          const user = await this.executeGetUser(token, { username: inputs.targetUsername });
          targetUserId = user.id;
        }
        if (!targetUserId) {
          throw new Error('Validation failed: either "targetUserId" or "targetUsername" must be provided');
        }
        const result = await this.executeFollowUser(token, userId, targetUserId);
        return redactObject(result as unknown as Record<string, unknown>);
      }

      case 'unfollow-user': {
        const token = await this.requireAccessToken();
        const userId = await this.resolveUserId(token);
        const targetUserId = this.requireString(inputs.targetUserId, 'targetUserId');
        const result = await this.executeUnfollowUser(token, userId, targetUserId);
        return redactObject(result as unknown as Record<string, unknown>);
      }

      case 'upload-media': {
        const token = await this.requireAccessToken();
        const filePath = this.requireString(inputs.filePath, 'filePath');
        const mediaCategory = typeof inputs.mediaCategory === 'string' ? inputs.mediaCategory : 'tweet_image';
        const altText = typeof inputs.altText === 'string' ? inputs.altText : undefined;
        const result = await this.executeUploadMedia(token, filePath, mediaCategory, altText);
        return redactObject(result as unknown as Record<string, unknown>);
      }

      case 'post-tweet': {
        const token = await this.requireAccessToken();
        const text = this.requireString(inputs.text, 'text');
        const inReplyToTweetId = typeof inputs.inReplyToTweetId === 'string' ? inputs.inReplyToTweetId.trim() : undefined;
        const mediaIds = Array.isArray(inputs.mediaIds) ? (inputs.mediaIds as string[]) : undefined;
        const poll = inputs.poll && typeof inputs.poll === 'object' ? (inputs.poll as XPollInput) : undefined;
        const result = await this.executePostTweet(token, { text, inReplyToTweetId, mediaIds, poll });
        return redactObject(result as unknown as Record<string, unknown>);
      }

      case 'delete-tweet': {
        const token = await this.requireAccessToken();
        const tweetId = this.requireString(inputs.tweetId, 'tweetId');
        const result = await this.executeDeleteTweet(token, tweetId);
        return redactObject(result as unknown as Record<string, unknown>);
      }

      default:
        throw new Error(`Unknown action "${action}" for bridge "x"`);
    }
  }

  // --- Implementation Details ---

  private async executeMe(token: string): Promise<{
    id: string;
    name: string;
    username: string;
    description?: string;
    profile_image_url?: string;
    public_metrics?: Record<string, number>;
    verified?: boolean;
    verified_type?: string;
    httpStatus: number;
    timestamp: string;
  }> {
    const url = `${this.apiBaseUrl}/2/users/me?user.fields=description,profile_image_url,public_metrics,verified,verified_type`;
    const res = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, [token]);

    const body = await this.parseJsonResponse<{ data?: Record<string, unknown> }>(res, [token]);
    const data = body.data || {};

    return {
      id: String(data.id || ''),
      name: String(data.name || ''),
      username: String(data.username || ''),
      description: data.description ? String(data.description) : undefined,
      profile_image_url: data.profile_image_url ? String(data.profile_image_url) : undefined,
      public_metrics: data.public_metrics as Record<string, number> | undefined,
      verified: Boolean(data.verified),
      verified_type: data.verified_type ? String(data.verified_type) : undefined,
      httpStatus: res.status,
      timestamp: new Date().toISOString(),
    };
  }

  private async executeGetUser(
    token: string,
    query: { username?: string; userId?: string },
  ): Promise<{
    id: string;
    name: string;
    username: string;
    description?: string;
    public_metrics?: Record<string, number>;
    verified?: boolean;
    httpStatus: number;
  }> {
    let url: string;
    if (query.username) {
      url = `${this.apiBaseUrl}/2/users/by/username/${encodeURIComponent(query.username)}?user.fields=description,profile_image_url,public_metrics,verified`;
    } else {
      url = `${this.apiBaseUrl}/2/users/${encodeURIComponent(query.userId!)}?user.fields=description,profile_image_url,public_metrics,verified`;
    }

    const res = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, [token]);

    const body = await this.parseJsonResponse<{ data?: Record<string, unknown> }>(res, [token]);
    const data = body.data || {};

    return {
      id: String(data.id || ''),
      name: String(data.name || ''),
      username: String(data.username || ''),
      description: data.description ? String(data.description) : undefined,
      public_metrics: data.public_metrics as Record<string, number> | undefined,
      verified: Boolean(data.verified),
      httpStatus: res.status,
    };
  }

  private async executeGetTweet(
    token: string,
    tweetId: string,
  ): Promise<{
    id: string;
    text: string;
    authorId?: string;
    authorUsername?: string;
    createdAt?: string;
    public_metrics?: Record<string, number>;
    media?: Array<Record<string, unknown>>;
    tweetUrl: string;
    httpStatus: number;
  }> {
    const url = `${this.apiBaseUrl}/2/tweets/${encodeURIComponent(tweetId)}?tweet.fields=created_at,author_id,public_metrics,entities,attachments&expansions=attachments.media_keys,author_id&media.fields=url,preview_image_url,type,duration_ms,variants,public_metrics&user.fields=username,name`;

    const res = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, [token]);

    const body = await this.parseJsonResponse<{
      data?: Record<string, unknown>;
      includes?: { media?: Array<Record<string, unknown>>; users?: Array<Record<string, unknown>> };
    }>(res, [token]);

    const data = body.data || {};
    const media = body.includes?.media || [];
    const users = body.includes?.users || [];
    const author = users.find((u) => u.id === data.author_id);

    return {
      id: String(data.id || tweetId),
      text: String(data.text || ''),
      authorId: data.author_id ? String(data.author_id) : undefined,
      authorUsername: author?.username ? String(author.username) : undefined,
      createdAt: data.created_at ? String(data.created_at) : undefined,
      public_metrics: data.public_metrics as Record<string, number> | undefined,
      media: media.length > 0 ? media : undefined,
      tweetUrl: `https://x.com/i/status/${tweetId}`,
      httpStatus: res.status,
    };
  }

  private async executeSearchTweets(
    token: string,
    query: string,
    maxResults: number,
  ): Promise<{
    tweets: Array<Record<string, unknown>>;
    resultCount: number;
    query: string;
    httpStatus: number;
  }> {
    const params = new URLSearchParams({
      query,
      max_results: String(maxResults),
      'tweet.fields': 'created_at,author_id,public_metrics,attachments',
      expansions: 'attachments.media_keys,author_id',
      'media.fields': 'url,preview_image_url,type,duration_ms,variants',
      'user.fields': 'username,name',
    });

    const url = `${this.apiBaseUrl}/2/tweets/search/recent?${params.toString()}`;
    const res = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, [token]);

    const body = await this.parseJsonResponse<{
      data?: Array<Record<string, unknown>>;
      meta?: { result_count?: number };
      includes?: { media?: Array<Record<string, unknown>>; users?: Array<Record<string, unknown>> };
    }>(res, [token]);

    const rawTweets = body.data || [];
    const mediaList = body.includes?.media || [];
    const usersList = body.includes?.users || [];

    const tweets = rawTweets.map((t) => {
      const author = usersList.find((u) => u.id === t.author_id);
      return {
        ...t,
        authorUsername: author?.username,
        authorName: author?.name,
        tweetUrl: `https://x.com/i/status/${t.id}`,
      };
    });

    return {
      tweets,
      resultCount: body.meta?.result_count ?? tweets.length,
      query,
      httpStatus: res.status,
    };
  }

  private async executeGetTimeline(
    token: string,
    userId: string,
    maxResults: number,
  ): Promise<{
    tweets: Array<Record<string, unknown>>;
    count: number;
    httpStatus: number;
  }> {
    const url = `${this.apiBaseUrl}/2/users/${encodeURIComponent(userId)}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics,attachments&expansions=attachments.media_keys`;
    const res = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, [token]);

    const body = await this.parseJsonResponse<{ data?: Array<Record<string, unknown>> }>(res, [token]);
    const tweets = (body.data || []).map((t) => ({
      ...t,
      tweetUrl: `https://x.com/i/status/${t.id}`,
    }));

    return {
      tweets,
      count: tweets.length,
      httpStatus: res.status,
    };
  }

  private async executeGetMentions(
    token: string,
    userId: string,
    maxResults: number,
  ): Promise<{
    mentions: Array<Record<string, unknown>>;
    count: number;
  }> {
    const url = `${this.apiBaseUrl}/2/users/${encodeURIComponent(userId)}/mentions?max_results=${maxResults}&tweet.fields=created_at,author_id,public_metrics`;
    const res = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, [token]);

    const body = await this.parseJsonResponse<{ data?: Array<Record<string, unknown>> }>(res, [token]);
    const mentions = body.data || [];

    return {
      mentions,
      count: mentions.length,
    };
  }

  private async executeDraftTweet(input: {
    text: string;
    inReplyToTweetId?: string;
    mediaIds?: string[];
    poll?: XPollInput;
    outputPath?: string;
  }): Promise<{
    draftPath: string;
    characterCount: number;
    payload: Record<string, unknown>;
    saved: boolean;
  }> {
    const text = input.text.trim();
    if (text.length === 0) {
      throw new Error('Validation failed: tweet text cannot be empty');
    }

    if (input.poll) {
      if (!Array.isArray(input.poll.options) || input.poll.options.length < 2 || input.poll.options.length > 4) {
        throw new Error('Validation failed: poll must contain between 2 and 4 options');
      }
      for (const opt of input.poll.options) {
        if (!opt || opt.trim().length === 0 || opt.length > 25) {
          throw new Error('Validation failed: each poll option must be 1 to 25 characters');
        }
      }
    }

    const payload: Record<string, unknown> = { text };
    if (input.inReplyToTweetId) {
      payload.reply = { in_reply_to_tweet_id: input.inReplyToTweetId };
    }
    if (input.mediaIds && input.mediaIds.length > 0) {
      payload.media = { media_ids: input.mediaIds };
    }
    if (input.poll) {
      payload.poll = {
        options: input.poll.options.map((o) => o.trim()),
        duration_minutes: input.poll.durationMinutes || 1440,
      };
    }

    const targetPath = input.outputPath
      ? this.resolveSafeLocalPath(input.outputPath)
      : resolve(process.cwd(), `tweet-draft-${Date.now()}.json`);

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf-8');

    return {
      draftPath: targetPath,
      characterCount: text.length,
      payload,
      saved: true,
    };
  }

  private async executeLikeTweet(
    token: string,
    userId: string,
    tweetId: string,
  ): Promise<{ liked: boolean; tweetId: string; httpStatus: number }> {
    const url = `${this.apiBaseUrl}/2/users/${encodeURIComponent(userId)}/likes`;
    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tweet_id: tweetId }),
    }, [token]);

    const body = await this.parseJsonResponse<{ data?: { liked?: boolean } }>(res, [token]);
    return {
      liked: body.data?.liked ?? true,
      tweetId,
      httpStatus: res.status,
    };
  }

  private async executeUnlikeTweet(
    token: string,
    userId: string,
    tweetId: string,
  ): Promise<{ unliked: boolean; tweetId: string; httpStatus: number }> {
    const url = `${this.apiBaseUrl}/2/users/${encodeURIComponent(userId)}/likes/${encodeURIComponent(tweetId)}`;
    const res = await this.fetchWithRetry(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, [token]);

    const body = await this.parseJsonResponse<{ data?: { liked?: boolean } }>(res, [token]);
    return {
      unliked: !(body.data?.liked ?? false),
      tweetId,
      httpStatus: res.status,
    };
  }

  private async executeRetweet(
    token: string,
    userId: string,
    tweetId: string,
  ): Promise<{ retweeted: boolean; tweetId: string; httpStatus: number }> {
    const url = `${this.apiBaseUrl}/2/users/${encodeURIComponent(userId)}/retweets`;
    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tweet_id: tweetId }),
    }, [token]);

    const body = await this.parseJsonResponse<{ data?: { retweeted?: boolean } }>(res, [token]);
    return {
      retweeted: body.data?.retweeted ?? true,
      tweetId,
      httpStatus: res.status,
    };
  }

  private async executeFollowUser(
    token: string,
    userId: string,
    targetUserId: string,
  ): Promise<{ following: boolean; targetUserId: string; pendingFollow: boolean; httpStatus: number }> {
    const url = `${this.apiBaseUrl}/2/users/${encodeURIComponent(userId)}/following`;
    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_user_id: targetUserId }),
    }, [token]);

    const body = await this.parseJsonResponse<{
      data?: { following?: boolean; pending_follow?: boolean };
    }>(res, [token]);

    return {
      following: body.data?.following ?? true,
      targetUserId,
      pendingFollow: Boolean(body.data?.pending_follow),
      httpStatus: res.status,
    };
  }

  private async executeUnfollowUser(
    token: string,
    userId: string,
    targetUserId: string,
  ): Promise<{ unfollowed: boolean; targetUserId: string }> {
    const url = `${this.apiBaseUrl}/2/users/${encodeURIComponent(userId)}/following/${encodeURIComponent(targetUserId)}`;
    const res = await this.fetchWithRetry(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, [token]);

    const body = await this.parseJsonResponse<{ data?: { following?: boolean } }>(res, [token]);
    return {
      unfollowed: !(body.data?.following ?? false),
      targetUserId,
    };
  }

  private async executeUploadMedia(
    token: string,
    filePath: string,
    mediaCategory: string,
    altText?: string,
  ): Promise<{
    success: boolean;
    mediaId: string;
    mimeType: string;
    bytesUploaded: number;
    httpStatus: number;
  }> {
    const { resolvedPath, mimeType, size } = await this.validateLocalMediaFile(filePath);

    // X Media Upload API v1.1 endpoint
    const url = `${this.uploadBaseUrl}/1.1/media/upload.json`;
    const fileBytes = await readFile(resolvedPath);

    const formData = new FormData();
    const blob = new Blob([fileBytes], { type: mimeType });
    formData.append('media', blob, resolvedPath.split(/[\/\\]/).pop());
    formData.append('media_category', mediaCategory);

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }, [token]);

    const body = await this.parseJsonResponse<{ media_id_string?: string }>(res, [token]);
    const mediaId = body.media_id_string || 'media_' + Date.now();

    if (altText && mediaId) {
      try {
        await this.fetchWithRetry(`${this.uploadBaseUrl}/1.1/media/metadata/create.json`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            media_id: mediaId,
            alt_text: { text: altText },
          }),
        }, [token]);
      } catch {
        // Alt text is optional; don't fail upload if metadata call fails
      }
    }

    return {
      success: true,
      mediaId,
      mimeType,
      bytesUploaded: size,
      httpStatus: res.status,
    };
  }

  private async executePostTweet(
    token: string,
    input: {
      text: string;
      inReplyToTweetId?: string;
      mediaIds?: string[];
      poll?: XPollInput;
    },
  ): Promise<{
    published: boolean;
    tweetId: string;
    tweetUrl: string;
    text: string;
    httpStatus: number;
    timestamp: string;
  }> {
    const text = input.text.trim();
    if (text.length === 0) {
      throw new Error('Validation failed: tweet text cannot be empty');
    }

    const payload: Record<string, unknown> = { text };
    if (input.inReplyToTweetId) {
      payload.reply = { in_reply_to_tweet_id: input.inReplyToTweetId };
    }
    if (input.mediaIds && input.mediaIds.length > 0) {
      payload.media = { media_ids: input.mediaIds };
    }
    if (input.poll) {
      payload.poll = {
        options: input.poll.options.map((o) => o.trim()),
        duration_minutes: input.poll.durationMinutes || 1440,
      };
    }

    const url = `${this.apiBaseUrl}/2/tweets`;
    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }, [token]);

    const body = await this.parseJsonResponse<{ data?: { id?: string; text?: string } }>(res, [token]);
    const tweetId = body.data?.id || 'unknown';

    return {
      published: true,
      tweetId,
      tweetUrl: `https://x.com/i/status/${tweetId}`,
      text: body.data?.text || text,
      httpStatus: res.status,
      timestamp: new Date().toISOString(),
    };
  }

  private async executeDeleteTweet(
    token: string,
    tweetId: string,
  ): Promise<{ deleted: boolean; tweetId: string; httpStatus: number }> {
    const url = `${this.apiBaseUrl}/2/tweets/${encodeURIComponent(tweetId)}`;
    const res = await this.fetchWithRetry(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, [token]);

    const body = await this.parseJsonResponse<{ data?: { deleted?: boolean } }>(res, [token]);
    return {
      deleted: body.data?.deleted ?? true,
      tweetId,
      httpStatus: res.status,
    };
  }

  // --- Helper Methods ---

  private async resolveAccessToken(): Promise<string | null> {
    const envToken = (process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN)?.trim();
    if (envToken) return envToken;

    const creds = await this.store.load('x');
    if (creds && creds.accessToken) {
      const isExpired = creds.expiresAt ? creds.expiresAt < Date.now() : false;
      if (!isExpired) return creds.accessToken;
    }

    return null;
  }

  private async requireAccessToken(): Promise<string> {
    const token = await this.resolveAccessToken();
    if (!token) {
      throw new Error(
        'Authentication required: X_ACCESS_TOKEN environment variable is not set. Run interactive authentication or configure credentials.',
      );
    }
    return token;
  }

  private async resolveUserId(token: string): Promise<string> {
    if (process.env.X_USER_ID?.trim()) {
      return process.env.X_USER_ID.trim();
    }
    const creds = await this.store.load('x');
    if (creds?.userId) {
      return creds.userId;
    }
    const me = await this.executeMe(token);
    return me.id;
  }

  private requireString(val: unknown, fieldName: string): string {
    if (typeof val !== 'string' || val.trim().length === 0) {
      throw new Error(`Validation failed: "${fieldName}" is required and must be a non-empty string`);
    }
    return val.trim();
  }

  private assertSafePathSyntax(filePath: string): void {
    if (filePath.includes('\0')) {
      throw new Error('Security Violation: File path contains null byte');
    }
    if (filePath.startsWith('\\\\') || filePath.startsWith('//')) {
      throw new Error('Security Violation: UNC network file paths are not allowed');
    }
  }

  private resolveSafeLocalPath(userPath: string): string {
    this.assertSafePathSyntax(userPath);
    const resolved = resolve(normalize(userPath));

    const lower = resolved.toLowerCase();
    if (
      lower.includes('\\windows\\system32') ||
      lower.startsWith('/etc/') ||
      lower.startsWith('/proc/') ||
      lower.startsWith('/sys/')
    ) {
      throw new Error(`Security Violation: Access to protected system path is blocked`);
    }

    if (this.allowedBaseDir) {
      const rel = relative(this.allowedBaseDir, resolved);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`Security Violation: Path "${userPath}" is outside allowed root "${this.allowedBaseDir}"`);
      }
    }

    return resolved;
  }

  private async validateLocalMediaFile(filePath: string): Promise<{
    resolvedPath: string;
    mimeType: string;
    size: number;
  }> {
    const resolvedPath = this.resolveSafeLocalPath(filePath);
    const ext = extname(resolvedPath).toLowerCase();
    const mimeType = MEDIA_MIME_TYPES[ext];
    if (!mimeType) {
      throw new Error(
        `Validation failed: unsupported media extension "${ext || '(none)'}" — allowed extensions: .png, .jpg, .jpeg, .webp, .gif, .mp4, .mov`,
      );
    }

    let fileStat;
    try {
      fileStat = await stat(resolvedPath);
    } catch {
      throw new Error(`Media file not found: "${resolvedPath}"`);
    }

    if (!fileStat.isFile()) {
      throw new Error(`Validation failed: "${resolvedPath}" is not a regular file`);
    }
    if (fileStat.size <= 0) {
      throw new Error(`Validation failed: media file "${resolvedPath}" is empty`);
    }

    const limit = mimeType.startsWith('video/')
      ? MAX_X_VIDEO_BYTES
      : mimeType === 'image/gif'
      ? MAX_X_GIF_BYTES
      : MAX_X_IMAGE_BYTES;

    if (fileStat.size > limit) {
      throw new Error(`Validation failed: media file exceeds ${limit} bytes limit`);
    }

    return { resolvedPath, mimeType, size: fileStat.size };
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    secretsToScrub: (string | undefined)[],
  ): Promise<Response> {
    const fetchImpl = this.customFetchFn ?? globalThis.fetch;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: Response;
      try {
        response = await fetchImpl(url, init);
      } catch (err) {
        const msg = sanitizeErrorString((err as Error)?.message || String(err), secretsToScrub);
        throw new Error(`X network request failed: ${msg}`);
      }

      if (response.ok) {
        return response;
      }

      const isTransient = response.status === 429 || (response.status >= 500 && response.status <= 599);
      const rawErrBody = await response.text().catch(() => '');
      const cleanBody = sanitizeErrorString(rawErrBody, secretsToScrub).slice(0, 500);
      const errorMsg = `X API error HTTP ${response.status}${cleanBody ? `: ${cleanBody}` : ''}`;

      if (!isTransient || attempt === this.maxRetries) {
        throw new Error(errorMsg);
      }

      lastError = new Error(errorMsg);
      if (this.retryDelayMs > 0) {
        await new Promise((resolveTimer) => setTimeout(resolveTimer, this.retryDelayMs * (attempt + 1)));
      }
    }

    throw lastError || new Error('X request failed after retries');
  }

  private async parseJsonResponse<T>(
    response: Response,
    secretsToScrub: (string | undefined)[],
  ): Promise<T> {
    const raw = await response.text().catch(() => '');
    try {
      return JSON.parse(raw) as T;
    } catch {
      const safePreview = sanitizeErrorString(raw, secretsToScrub).slice(0, 200);
      throw new Error(`X API returned invalid JSON (${response.status}): ${safePreview}`);
    }
  }
}
