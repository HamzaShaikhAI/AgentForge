import { describe, it, expect } from 'vitest';
import { redactSecret, maskEmail, redactObject, timingSafeStringEqual, sanitizeErrorString } from './redact.js';

describe('Security Redaction Utility', () => {
  it('redacts secret tokens and strings', () => {
    expect(redactSecret(null)).toBe('[EMPTY]');
    expect(redactSecret('')).toBe('[EMPTY]');
    expect(redactSecret('short')).toBe('[REDACTED]');
    expect(redactSecret('ya29.mock-sample-token-1234567890def')).toBe('ya2...def');
  });

  it('masks email addresses for user privacy', () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail('developer@example.com')).toBe('d*******r@example.com');
    expect(maskEmail('me@example.com')).toBe('m*@example.com');
    expect(maskEmail('invalid-email')).toBe('[REDACTED_EMAIL]');
  });

  it('deeply redacts sensitive keys from objects and logs', () => {
    const raw = {
      username: 'agent-dev',
      client_secret: 'GOCSPX-mock-dummy-secret-123456',
      nested: {
        access_token: 'ya29.mock-access-secret-token',
        refresh_token: '1//mock-refresh-secret-token',
        safeProperty: 42,
      },
      tokensList: [
        { id: 1, authorization_code: '4/authcode123' },
        { id: 2, status: 'active' },
      ],
    };

    const redacted = redactObject(raw);

    // Safe properties are kept intact
    expect(redacted.username).toBe('agent-dev');
    expect(redacted.nested.safeProperty).toBe(42);
    expect(redacted.tokensList[1].status).toBe('active');

    // Sensitive keys are redacted
    expect(redacted.client_secret).toBe('[REDACTED]');
    expect(redacted.nested.access_token).toBe('[REDACTED]');
    expect(redacted.nested.refresh_token).toBe('[REDACTED]');
    expect(redacted.tokensList[0].authorization_code).toBe('[REDACTED]');
  });

  it('performs constant-time string equality comparison', () => {
    expect(timingSafeStringEqual('state-token-123', 'state-token-123')).toBe(true);
    expect(timingSafeStringEqual('state-token-123', 'state-token-456')).toBe(false);
    expect(timingSafeStringEqual('short', 'longer-string')).toBe(false);
  });

  it('scrubs tokens, client secrets, and codes from error messages', () => {
    const rawError =
      'OAuth exchange failed with code 4/mock-authcode-secret-xyz using client secret GOCSPX-mock-secret123 and token ya29.mock-access-token-xyz and refresh token 1//mock-refresh-token-xyz';
    const scrubbed = sanitizeErrorString(rawError, ['custom-secret-key']);

    expect(scrubbed).not.toContain('GOCSPX-mock-secret123');
    expect(scrubbed).not.toContain('ya29.mock-access-token-xyz');
    expect(scrubbed).not.toContain('1//mock-refresh-token-xyz');
    expect(scrubbed).toContain('[REDACTED_CLIENT_SECRET]');
    expect(scrubbed).toContain('[REDACTED_ACCESS_TOKEN]');
    expect(scrubbed).toContain('[REDACTED_REFRESH_TOKEN]');
  });
});

