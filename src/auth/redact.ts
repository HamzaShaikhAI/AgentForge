/**
 * Security Redaction Utility
 * Ensures secrets, tokens, and authorization codes are never leaked in logs,
 * CLI output, MCP responses, or workflow records.
 */

const SENSITIVE_KEY_PATTERN = /(token|secret|password|credential|authcode|authorization_code|client_secret|refresh_token|access_token|private_key|api_?key|apikey|sessionuri|uploadurl|upload_id|session_url)/i;

/**
 * Mask a secret string, leaving at most minimal hints or full redaction.
 */
export function redactSecret(secret?: string | null): string {
  if (!secret) return '[EMPTY]';
  if (secret.length <= 8) return '[REDACTED]';
  return `${secret.slice(0, 3)}...${secret.slice(-3)}`;
}

/**
 * Mask an email address for privacy (e.g., j***e@example.com).
 */
export function maskEmail(email?: string | null): string | null {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return '[REDACTED_EMAIL]';
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) {
    return `${name[0]}*@${domain}`;
  }
  return `${name[0]}${'*'.repeat(Math.max(1, name.length - 2))}${name.slice(-1)}@${domain}`;
}

/**
 * Deeply clone an object, replacing any values associated with sensitive keys with '[REDACTED]'.
 */
export function redactObject<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;

  if (Array.isArray(input)) {
    return input.map(item => redactObject(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value);
    } else if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

import { timingSafeEqual } from 'node:crypto';

/**
 * Perform a constant-time comparison of two strings to prevent timing side-channel attacks.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Scrub secrets, tokens, codes, and private keys from arbitrary error or log strings.
 */
export function sanitizeErrorString(text: string, secretsToScrub: (string | undefined)[] = []): string {
  if (!text) return text;
  let sanitized = text;

  // 1. Scrub specific known secrets passed in
  for (const secret of secretsToScrub) {
    if (secret && typeof secret === 'string' && secret.length >= 4) {
      sanitized = sanitized.split(secret).join('[REDACTED]');
    }
  }

  // 2. Scrub standard Google credential patterns and upload session tokens
  sanitized = sanitized.replace(/ya29\.[a-zA-Z0-9_-]+/g, '[REDACTED_ACCESS_TOKEN]');
  sanitized = sanitized.replace(/1\/\/[a-zA-Z0-9_-]+/g, '[REDACTED_REFRESH_TOKEN]');
  sanitized = sanitized.replace(/GOCSPX-[a-zA-Z0-9_-]+/g, '[REDACTED_CLIENT_SECRET]');
  sanitized = sanitized.replace(/4\/[a-zA-Z0-9_-]{20,}/g, '[REDACTED_AUTH_CODE]');
  sanitized = sanitized.replace(/upload_id=[a-zA-Z0-9_\-\.]+/gi, 'upload_id=[REDACTED_UPLOAD_ID]');

  return sanitized;
}

