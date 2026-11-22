import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { BaseIntegrationAdapter, AdapterHealthResult, AdapterActionDefinition } from './base-adapter.js';
import { redactObject, sanitizeErrorString } from '../auth/redact.js';
import { CredentialStore } from '../auth/types.js';
import { getDefaultCredentialStore } from '../auth/credential-store.js';

export const LINKEDIN_API_BASE_URL = 'https://api.linkedin.com';
export const LINKEDIN_DEFAULT_VERSION = '202601';
export const MAX_COMMENTARY_LENGTH = 3000;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

const VALID_VISIBILITIES = ['PUBLIC', 'CONNECTIONS'] as const;
const VALID_POLL_DURATIONS = ['ONE_DAY', 'THREE_DAYS', 'ONE_WEEK', 'TWO_WEEKS'] as const;
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};
const URN_PATTERN = /^urn:li:(person|organization):[A-Za-z0-9_-]+$/;
const IMAGE_URN_PATTERN = /^urn:li:(image|digitalmediaAsset):[A-Za-z0-9_-]+$/;

export interface LinkedInPollInput {
  question: string;
  options: string[];
  duration?: typeof VALID_POLL_DURATIONS[number];
}

export interface LinkedInDraftImageInput {
  path?: string;
  urn?: string;
  altText?: string;
}

export interface LinkedInProfileResult {
  sub: string;
  personUrn: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  picture?: string;
  verified: boolean;
  httpStatus: number;
  timestamp: string;
}

export interface LinkedInPostDraft {
  draftPath: string;
  payload: Record<string, unknown>;
  preview: {
    commentary: string;
    visibility: string;
    attachmentType: 'text' | 'article' | 'image' | 'poll';
    articleUrl?: string;
    image?: LinkedInDraftImageInput;
    poll?: LinkedInPollInput;
  };
  characterCount: number;
  saved: boolean;
  timestamp: string;
}

export interface LinkedInUploadImageResult {
  success: boolean;
  imageUrn: string;
  ownerUrn: string;
  mimeType: string;
  bytesUploaded: number;
  httpStatus: number;
  timestamp: string;
}

export interface LinkedInPublishPostResult {
  published: boolean;
  postUrn: string;
  postUrl?: string;
  visibility: string;
  httpStatus: number;
  timestamp: string;
}

export interface LinkedInAdapterOptions {
  fetchFn?: typeof fetch;
  apiBaseUrl?: string;
  apiVersion?: string;
  allowedBaseDir?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  credentialStore?: CredentialStore;
}

/**
 * LinkedIn REST Integration Adapter.
 * Uses environment-variable authentication exclusively (LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN),
 * validates all inputs and local paths, retries only transient HTTP 429/5xx failures,
 * and scrubs Authorization headers / Bearer tokens from all logs and errors.
 */
export class LinkedInAdapter extends BaseIntegrationAdapter {
  readonly name = 'linkedin';
  readonly displayName = 'LinkedIn';
  readonly description =
    'LinkedIn REST API integration: inspect member identity, draft local post previews, upload image assets, and publish posts.';
  readonly version = '1.0.0';
  readonly category = 'social-media';

  private customFetchFn?: typeof fetch;
  private apiBaseUrl: string;
  private apiVersion: string;
  private allowedBaseDir?: string;
  private maxRetries: number;
  private retryDelayMs: number;
  private store: CredentialStore;

  constructor(options: LinkedInAdapterOptions = {}) {
    super();
    this.customFetchFn = options.fetchFn;
    this.apiBaseUrl = (options.apiBaseUrl || LINKEDIN_API_BASE_URL).replace(/\/+$/, '');
    this.apiVersion = options.apiVersion || process.env.LINKEDIN_API_VERSION || LINKEDIN_DEFAULT_VERSION;
    this.allowedBaseDir = options.allowedBaseDir ? resolve(options.allowedBaseDir) : undefined;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    this.store = options.credentialStore || getDefaultCredentialStore();
  }

  getActions(): AdapterActionDefinition[] {
    return [
      {
        action: 'profile-me',
        description: 'Verify token and fetch authenticated LinkedIn member identity via /v2/userinfo',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'draft-post',
        description: 'Format, validate, and locally save a LinkedIn post preview JSON',
        permissionLevel: 'local-write',
        sideEffects: true,
        requiresApproval: false,
      },
      {
        action: 'upload-image',
        description: 'Initialize and upload a local PNG/JPG image via LinkedIn Images API',
        permissionLevel: 'external-write',
        sideEffects: true,
        requiresApproval: true,
      },
      {
        action: 'publish-post',
        description: 'Publish a text, link-card, poll, or image post via LinkedIn /rest/posts',
        permissionLevel: 'publish',
        sideEffects: true,
        requiresApproval: true,
      },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const envToken = process.env.LINKEDIN_ACCESS_TOKEN?.trim();
    const envPersonUrn = process.env.LINKEDIN_PERSON_URN?.trim();
    let stored = null;
    try {
      stored = await this.store.load('linkedin');
    } catch {}

    const token = envToken || stored?.accessToken;
    const personUrn =
      envPersonUrn ||
      (stored?.extraData?.personUrn as string) ||
      (stored?.userId ? `urn:li:person:${stored.userId}` : undefined);

    const hasToken = Boolean(token);
    const hasPersonUrn = Boolean(personUrn);
    const validUrn = hasPersonUrn && URN_PATTERN.test(personUrn!);

    if (hasToken && validUrn) {
      return {
        healthy: true,
        status: 'connected',
        message: stored?.extraData?.name
          ? `Connected to LinkedIn as ${stored.extraData.name} (${personUrn})`
          : 'LINKEDIN_ACCESS_TOKEN and LINKEDIN_PERSON_URN are configured',
        details: {
          apiVersion: this.apiVersion,
          hasToken: true,
          hasPersonUrn: true,
          source: envToken ? 'env' : 'credential-store',
        },
      };
    }

    const missing: string[] = [];
    if (!hasToken) missing.push('LINKEDIN_ACCESS_TOKEN');
    if (!hasPersonUrn) {
      missing.push('LINKEDIN_PERSON_URN');
    } else if (!validUrn) {
      return {
        healthy: false,
        status: 'error',
        message: 'LINKEDIN_PERSON_URN must match urn:li:person:<id> or urn:li:organization:<id>',
        details: { apiVersion: this.apiVersion, hasToken, hasPersonUrn: false },
      };
    }

    return {
      healthy: false,
      status: 'unconfigured',
      message: `${missing.join(' and ')} required (run "agentforge auth linkedin" or export env vars)`,
      details: { apiVersion: this.apiVersion, hasToken, hasPersonUrn },
    };
  }

  async execute(action: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    switch (action) {
      case 'profile-me':
        return this.getProfile();
      case 'draft-post':
        return this.draftPost(inputs);
      case 'upload-image':
        return this.uploadImage(inputs);
      case 'publish-post':
        return this.publishPost(inputs);
      default:
        throw new Error(`Unsupported action "${action}" on LinkedInAdapter`);
    }
  }

  /**
   * Fetch authenticated member identity via LinkedIn OIDC /v2/userinfo.
   */
  async getProfile(): Promise<LinkedInProfileResult> {
    const token = await this.requireAccessToken();
    const response = await this.fetchWithRetry(
      `${this.apiBaseUrl}/v2/userinfo`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
      [token],
    );

    const data = await this.parseJsonResponse<Record<string, unknown>>(response, [token]);
    const sub = typeof data.sub === 'string' ? data.sub : '';
    if (!sub) {
      throw new Error('LinkedIn /v2/userinfo response missing required "sub" member identifier');
    }

    const personUrn = sub.startsWith('urn:li:person:') ? sub : `urn:li:person:${sub}`;

    return {
      sub,
      personUrn,
      name: typeof data.name === 'string' ? data.name : undefined,
      givenName: typeof data.given_name === 'string' ? data.given_name : undefined,
      familyName: typeof data.family_name === 'string' ? data.family_name : undefined,
      email: typeof data.email === 'string' ? data.email : undefined,
      picture: typeof data.picture === 'string' ? data.picture : undefined,
      verified: true,
      httpStatus: response.status,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validate post content/attachments and save a local preview JSON before publishing.
   */
  async draftPost(inputs: Record<string, unknown>): Promise<LinkedInPostDraft> {
    const authorUrn = (await this.resolveAuthorUrn(inputs.authorUrn, false)) || 'urn:li:person:UNCONFIGURED';
    const validated = this.validateAndBuildPostPayload(inputs, authorUrn);

    const imageMeta = inputs.image && typeof inputs.image === 'object'
      ? (inputs.image as LinkedInDraftImageInput)
      : undefined;
    if (imageMeta?.path !== undefined && typeof imageMeta.path === 'string' && imageMeta.path.trim()) {
      // Check path safety without requiring remote upload yet
      this.assertSafePathSyntax(imageMeta.path);
    }

    const rawOutputPath = typeof inputs.outputPath === 'string' && inputs.outputPath.trim()
      ? inputs.outputPath.trim()
      : join(this.allowedBaseDir || process.cwd(), 'data', 'linkedin-drafts', `draft-${Date.now()}.json`);

    const draftPath = this.resolveSafeLocalPath(rawOutputPath);
    const timestamp = new Date().toISOString();

    const attachmentType: LinkedInPostDraft['preview']['attachmentType'] = validated.poll
      ? 'poll'
      : validated.imageUrn
        ? (validated.articleUrl ? 'article' : 'image')
        : validated.articleUrl
          ? 'article'
          : 'text';

    const preview: LinkedInPostDraft['preview'] = {
      commentary: validated.commentary,
      visibility: validated.visibility,
      attachmentType,
      ...(validated.articleUrl ? { articleUrl: validated.articleUrl } : {}),
      ...(imageMeta ? { image: redactObject(imageMeta) } : {}),
      ...(validated.poll ? { poll: validated.poll } : {}),
    };

    const document = redactObject({
      schema: '1.0',
      bridge: 'linkedin',
      createdAt: timestamp,
      characterCount: validated.commentary.length,
      preview,
      payload: validated.payload,
    });

    await mkdir(dirname(draftPath), { recursive: true });
    await writeFile(draftPath, JSON.stringify(document, null, 2), 'utf-8');

    return {
      draftPath,
      payload: validated.payload,
      preview,
      characterCount: validated.commentary.length,
      saved: true,
      timestamp,
    };
  }

  /**
   * Initialize and upload a local PNG/JPG image asset using LinkedIn Images API.
   */
  async uploadImage(inputs: Record<string, unknown>): Promise<LinkedInUploadImageResult> {
    const token = await this.requireAccessToken();
    const ownerUrn = (await this.resolveAuthorUrn(inputs.ownerUrn, true))!;

    const rawFilePath = inputs.filePath;
    if (typeof rawFilePath !== 'string' || !rawFilePath.trim()) {
      throw new Error('upload-image requires a non-empty string for "filePath"');
    }

    const { resolvedPath, mimeType, size } = await this.validateLocalImageFile(rawFilePath.trim());
    const imageBytes = await readFile(resolvedPath);

    // Step 1: initializeUpload
    const initUrl = `${this.apiBaseUrl}/rest/images?action=initializeUpload`;
    const initResponse = await this.fetchWithRetry(
      initUrl,
      {
        method: 'POST',
        headers: this.buildRestHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          initializeUploadRequest: {
            owner: ownerUrn,
          },
        }),
      },
      [token],
    );

    const initJson = await this.parseJsonResponse<{
      value?: { uploadUrl?: string; image?: string };
    }>(initResponse, [token]);

    const uploadUrl = initJson?.value?.uploadUrl;
    const imageUrn = initJson?.value?.image;

    if (!uploadUrl || !imageUrn) {
      throw new Error('LinkedIn initializeUpload response missing "value.uploadUrl" or "value.image"');
    }

    this.validateHttpsEndpointUrl(uploadUrl, 'LinkedIn uploadUrl');

    // Step 2: Binary PUT to presigned LinkedIn upload URL
    const putResponse = await this.fetchWithRetry(
      uploadUrl,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mimeType,
        },
        body: imageBytes,
      },
      [token, uploadUrl],
    );

    return {
      success: true,
      imageUrn,
      ownerUrn,
      mimeType,
      bytesUploaded: size,
      httpStatus: putResponse.status,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Publish a text, link-card, poll, or image post via LinkedIn REST /rest/posts.
   */
  async publishPost(inputs: Record<string, unknown>): Promise<LinkedInPublishPostResult> {
    const token = await this.requireAccessToken();
    const authorUrn = (await this.resolveAuthorUrn(inputs.authorUrn, true))!;
    const { payload, visibility } = this.validateAndBuildPostPayload(inputs, authorUrn);

    const response = await this.fetchWithRetry(
      `${this.apiBaseUrl}/rest/posts`,
      {
        method: 'POST',
        headers: this.buildRestHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      },
      [token],
    );

    const headerUrn = response.headers.get('x-restli-id') || response.headers.get('X-RestLi-Id');
    let bodyUrn: string | undefined;
    const rawBody = await response.text().catch(() => '');
    if (rawBody) {
      try {
        const parsed = JSON.parse(rawBody) as { id?: string };
        if (typeof parsed.id === 'string') {
          bodyUrn = parsed.id;
        }
      } catch {
        // 201 Created responses from /rest/posts commonly have an empty body
      }
    }

    const postUrn = (headerUrn || bodyUrn || '').trim();
    if (!postUrn) {
      throw new Error('LinkedIn /rest/posts succeeded but did not return an "x-restli-id" post URN');
    }

    return {
      published: true,
      postUrn,
      postUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`,
      visibility,
      httpStatus: response.status,
      timestamp: new Date().toISOString(),
    };
  }

  private buildRestHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'LinkedIn-Version': this.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
      ...extra,
    };
  }

  private async requireAccessToken(): Promise<string> {
    const envToken = process.env.LINKEDIN_ACCESS_TOKEN?.trim();
    if (envToken) return envToken;
    try {
      const stored = await this.store.load('linkedin');
      if (stored?.accessToken?.trim()) {
        return stored.accessToken.trim();
      }
    } catch {}
    throw new Error(
      'Missing LINKEDIN_ACCESS_TOKEN. Run "agentforge auth linkedin" to sign in with Google Chrome, or export LINKEDIN_ACCESS_TOKEN.',
    );
  }

  private async resolveAuthorUrn(override: unknown, required: boolean): Promise<string | undefined> {
    if (typeof override === 'string' && override.trim()) {
      const candidate = override.trim();
      if (!URN_PATTERN.test(candidate)) {
        throw new Error(
          `Invalid LinkedIn URN "${candidate}": expected urn:li:person:<id> or urn:li:organization:<id>`,
        );
      }
      return candidate;
    }

    const envUrn = process.env.LINKEDIN_PERSON_URN?.trim();
    if (envUrn) {
      if (!URN_PATTERN.test(envUrn)) {
        throw new Error(
          `Invalid LinkedIn URN "${envUrn}": expected urn:li:person:<id> or urn:li:organization:<id>`,
        );
      }
      return envUrn;
    }

    try {
      const stored = await this.store.load('linkedin');
      const candidate =
        (stored?.extraData?.personUrn as string) ||
        (stored?.userId ? `urn:li:person:${stored.userId}` : undefined);
      if (candidate && URN_PATTERN.test(candidate)) {
        return candidate;
      }
    } catch {}

    if (required) {
      throw new Error(
        'Missing LINKEDIN_PERSON_URN. Run "agentforge auth linkedin" to sign in with Google Chrome, or export LINKEDIN_PERSON_URN.',
      );
    }
    return undefined;
  }

  private validateAndBuildPostPayload(
    inputs: Record<string, unknown>,
    authorUrn: string,
  ): {
    commentary: string;
    visibility: typeof VALID_VISIBILITIES[number];
    articleUrl?: string;
    imageUrn?: string;
    poll?: LinkedInPollInput;
    payload: Record<string, unknown>;
  } {
    const rawCommentary = inputs.commentary;
    if (typeof rawCommentary !== 'string' || !rawCommentary.trim()) {
      throw new Error('Validation failed: "commentary" must be a non-empty string');
    }
    const commentary = rawCommentary.trim();
    if (commentary.length > MAX_COMMENTARY_LENGTH) {
      throw new Error(
        `Validation failed: "commentary" exceeds LinkedIn maximum length of ${MAX_COMMENTARY_LENGTH} characters (got ${commentary.length})`,
      );
    }

    const rawVisibility = inputs.visibility !== undefined ? String(inputs.visibility) : 'PUBLIC';
    if (!VALID_VISIBILITIES.includes(rawVisibility as typeof VALID_VISIBILITIES[number])) {
      throw new Error(`Validation failed: "visibility" must be one of ${VALID_VISIBILITIES.join(', ')}`);
    }
    const visibility = rawVisibility as typeof VALID_VISIBILITIES[number];

    let articleUrl: string | undefined;
    if (inputs.articleUrl !== undefined && inputs.articleUrl !== null && String(inputs.articleUrl).trim() !== '') {
      articleUrl = this.validatePublicHttpUrl(String(inputs.articleUrl).trim(), 'articleUrl');
    }

    let imageUrn: string | undefined;
    if (inputs.imageUrn !== undefined && inputs.imageUrn !== null && String(inputs.imageUrn).trim() !== '') {
      const candidate = String(inputs.imageUrn).trim();
      if (!IMAGE_URN_PATTERN.test(candidate)) {
        throw new Error(`Validation failed: invalid "imageUrn" format "${candidate}"`);
      }
      imageUrn = candidate;
    } else if (
      inputs.image &&
      typeof inputs.image === 'object' &&
      typeof (inputs.image as LinkedInDraftImageInput).urn === 'string' &&
      (inputs.image as LinkedInDraftImageInput).urn!.trim()
    ) {
      const candidate = (inputs.image as LinkedInDraftImageInput).urn!.trim();
      if (!IMAGE_URN_PATTERN.test(candidate)) {
        throw new Error(`Validation failed: invalid "image.urn" format "${candidate}"`);
      }
      imageUrn = candidate;
    }

    let poll: LinkedInPollInput | undefined;
    if (inputs.poll !== undefined && inputs.poll !== null) {
      poll = this.validatePoll(inputs.poll);
    }

    if (poll && (articleUrl || imageUrn)) {
      throw new Error('Validation failed: LinkedIn poll posts cannot also attach an articleUrl or imageUrn');
    }

    const payload: Record<string, unknown> = {
      author: authorUrn,
      commentary,
      visibility,
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (poll) {
      payload.content = {
        poll: {
          question: poll.question,
          options: poll.options.map(text => ({ text })),
          settings: {
            duration: poll.duration || 'ONE_WEEK',
          },
        },
      };
    } else if (articleUrl) {
      const articleObj: Record<string, unknown> = {
        source: articleUrl,
      };
      if (typeof inputs.articleTitle === 'string' && inputs.articleTitle.trim()) {
        articleObj.title = inputs.articleTitle.trim();
      }
      if (typeof inputs.articleDescription === 'string' && inputs.articleDescription.trim()) {
        articleObj.description = inputs.articleDescription.trim();
      }
      if (imageUrn) {
        articleObj.thumbnail = imageUrn;
      }
      payload.content = { article: articleObj };
    } else if (imageUrn) {
      const mediaObj: Record<string, unknown> = {
        id: imageUrn,
      };
      const altText = typeof inputs.imageAltText === 'string'
        ? inputs.imageAltText.trim()
        : (inputs.image && typeof (inputs.image as LinkedInDraftImageInput).altText === 'string'
            ? (inputs.image as LinkedInDraftImageInput).altText!.trim()
            : '');
      if (altText) {
        mediaObj.altText = altText;
      }
      payload.content = { media: mediaObj };
    }

    return { commentary, visibility, articleUrl, imageUrn, poll, payload };
  }

  private validatePoll(rawPoll: unknown): LinkedInPollInput {
    if (!rawPoll || typeof rawPoll !== 'object') {
      throw new Error('Validation failed: "poll" must be an object with "question" and "options"');
    }
    const p = rawPoll as Record<string, unknown>;
    if (typeof p.question !== 'string' || !p.question.trim()) {
      throw new Error('Validation failed: "poll.question" must be a non-empty string');
    }
    const question = p.question.trim();
    if (question.length > 140) {
      throw new Error('Validation failed: "poll.question" cannot exceed 140 characters');
    }

    if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > 4) {
      throw new Error('Validation failed: "poll.options" must contain between 2 and 4 string options');
    }
    const options = p.options.map((opt, idx) => {
      if (typeof opt !== 'string' || !opt.trim()) {
        throw new Error(`Validation failed: "poll.options[${idx}]" must be a non-empty string`);
      }
      const trimmed = opt.trim();
      if (trimmed.length > 30) {
        throw new Error(`Validation failed: "poll.options[${idx}]" cannot exceed 30 characters`);
      }
      return trimmed;
    });

    let duration: typeof VALID_POLL_DURATIONS[number] = 'ONE_WEEK';
    if (p.duration !== undefined) {
      if (!VALID_POLL_DURATIONS.includes(p.duration as typeof VALID_POLL_DURATIONS[number])) {
        throw new Error(`Validation failed: "poll.duration" must be one of ${VALID_POLL_DURATIONS.join(', ')}`);
      }
      duration = p.duration as typeof VALID_POLL_DURATIONS[number];
    }

    return { question, options, duration };
  }

  private validatePublicHttpUrl(rawUrl: string, fieldName: string): string {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Validation failed: "${fieldName}" is not a valid URL`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Validation failed: "${fieldName}" protocol "${parsed.protocol}" is not allowed (use http or https)`);
    }

    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.endsWith('.local')
    ) {
      throw new Error(`Validation failed: "${fieldName}" cannot point to private/loopback host "${host}"`);
    }

    return parsed.toString();
  }

  private validateHttpsEndpointUrl(rawUrl: string, label: string): void {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Security error: ${label} returned an invalid URL`);
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`Security error: ${label} must use HTTPS before transmitting Authorization credentials`);
    }
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

  private async validateLocalImageFile(filePath: string): Promise<{
    resolvedPath: string;
    mimeType: string;
    size: number;
  }> {
    const resolvedPath = this.resolveSafeLocalPath(filePath);
    const ext = extname(resolvedPath).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES[ext];
    if (!mimeType) {
      throw new Error(
        `Validation failed: unsupported image extension "${ext || '(none)'}" — allowed extensions: .png, .jpg, .jpeg, .gif`,
      );
    }

    let fileStat;
    try {
      fileStat = await stat(resolvedPath);
    } catch {
      throw new Error(`Image file not found: "${resolvedPath}"`);
    }

    if (!fileStat.isFile()) {
      throw new Error(`Validation failed: "${resolvedPath}" is not a regular file`);
    }
    if (fileStat.size <= 0) {
      throw new Error(`Validation failed: image file "${resolvedPath}" is empty`);
    }
    if (fileStat.size > MAX_IMAGE_BYTES) {
      throw new Error(`Validation failed: image file exceeds ${MAX_IMAGE_BYTES} bytes limit`);
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
        throw new Error(`LinkedIn network request failed: ${msg}`);
      }

      if (response.ok) {
        return response;
      }

      const isTransient = response.status === 429 || (response.status >= 500 && response.status <= 599);
      const rawErrBody = await response.text().catch(() => '');
      const cleanBody = sanitizeErrorString(rawErrBody, secretsToScrub).slice(0, 500);
      const errorMsg = `LinkedIn API error HTTP ${response.status}${cleanBody ? `: ${cleanBody}` : ''}`;

      if (!isTransient || attempt === this.maxRetries) {
        throw new Error(errorMsg);
      }

      lastError = new Error(errorMsg);
      if (this.retryDelayMs > 0) {
        await new Promise(resolveTimer => setTimeout(resolveTimer, this.retryDelayMs * (attempt + 1)));
      }
    }

    throw lastError || new Error('LinkedIn request failed after retries');
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
      throw new Error(`LinkedIn API returned invalid JSON (${response.status}): ${safePreview}`);
    }
  }
}
