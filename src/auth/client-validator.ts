/**
 * Google OAuth Client ID Validator & Diagnostics
 *
 * Enforces RFC 8252 (OAuth 2.0 for Native Apps) client format rules,
 * detects placeholder/dummy client IDs, and prevents malformed credentials.
 */

import { ClientIdValidation } from './types.js';

/**
 * Known placeholder client ID patterns from templates, docs, or tests.
 * Any client matching these patterns must be strictly rejected from activating
 * production OAuth flows.
 */
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /custom-manager-client/i,
  /^custom[-_]/i,
  /your[-_]?client[-_]?id/i,
  /placeholder/i,
  /example/i,
  /xxx+/i,
  /sample[-_]?client/i,
  /mock[-_]?client/i,
  /dummy/i,
  /<[^>]+>/,
];

/**
 * Google Cloud OAuth 2.0 Client ID domain pattern:
 * Allows standard <project-number>-<hash>.apps.googleusercontent.com
 * or registered desktop publisher domains (*.apps.googleusercontent.com).
 */
export const GOOGLE_CLIENT_ID_REGEX = /^(\d+-[a-z0-9_]+|[a-z0-9_-]+)\.apps\.googleusercontent\.com$/i;

/**
 * Standard Google Cloud project client format:
 * Numeric project ID (10-14 digits) followed by hyphen and hash.
 */
export const STANDARD_GOOGLE_PROJECT_CLIENT_REGEX = /^\d+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i;

/**
 * Validate a Google OAuth Client ID for syntax correctness and placeholder detection.
 */
export function validateGoogleClientId(clientId?: string | null): ClientIdValidation {
  if (!clientId || !clientId.trim()) {
    return {
      valid: false,
      status: 'missing',
      reason: 'OAuth Client ID is missing or empty.',
    };
  }

  const trimmed = clientId.trim();

  // 1. Check for known placeholder patterns
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        status: 'placeholder',
        isPlaceholder: true,
        reason: `Client ID "${trimmed}" is a dummy or test placeholder. A real Google Cloud Desktop OAuth Client ID is required.`,
      };
    }
  }

  // 2. Must end with .apps.googleusercontent.com and have valid characters
  if (!GOOGLE_CLIENT_ID_REGEX.test(trimmed)) {
    return {
      valid: false,
      status: 'malformed',
      reason: `Client ID "${trimmed}" does not match the Google Cloud OAuth client ID format ("<project-number>-<hash>.apps.googleusercontent.com"). Ensure you selected "Desktop app" application type in Google Cloud Console.`,
    };
  }

  return {
    valid: true,
    status: 'valid',
  };
}
