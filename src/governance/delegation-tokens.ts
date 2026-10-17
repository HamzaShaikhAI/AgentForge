import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PermissionLevel, PERMISSION_HIERARCHY } from '../types.js';

export interface DelegationClaims {
  tokenId: string;
  subject: string;
  allowedBridges: string[];
  allowedActions: string[];
  maxPermissionLevel: PermissionLevel;
  issuedAt: number;
  expiresAt: number;
}

export interface CreateDelegationOptions {
  subject: string;
  allowedBridges: string[];
  allowedActions: string[];
  maxPermissionLevel: PermissionLevel;
  ttlSeconds?: number;
}

export interface DelegationVerificationResult {
  valid: boolean;
  claims?: DelegationClaims;
  error?: string;
}

function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Scoped Delegation Token Manager for AgentForge.
 * Enables issuing and cryptographically verifying fine-grained delegation tokens
 * for subagents and background workers with capability and permission restrictions.
 */
export class DelegationTokenService {
  private secret: string;
  private revokedTokens = new Map<string, { revokedAt: number; reason?: string }>();

  constructor(secret?: string) {
    this.secret = secret || randomBytes(32).toString('hex');
  }

  /**
   * Issue a signed scoped delegation token.
   */
  issueToken(options: CreateDelegationOptions): string {
    const tokenId = `dtkn_${randomBytes(16).toString('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + (options.ttlSeconds ?? 3600);

    const claims: DelegationClaims = {
      tokenId,
      subject: options.subject,
      allowedBridges: options.allowedBridges,
      allowedActions: options.allowedActions,
      maxPermissionLevel: options.maxPermissionLevel,
      issuedAt: now,
      expiresAt,
    };

    const header = { alg: 'HS256', typ: 'AF-DEL' };
    const headerEncoded = base64UrlEncode(JSON.stringify(header));
    const payloadEncoded = base64UrlEncode(JSON.stringify(claims));

    const signature = createHmac('sha256', this.secret)
      .update(`${headerEncoded}.${payloadEncoded}`)
      .digest();
    const signatureEncoded = base64UrlEncode(signature);

    return `${headerEncoded}.${payloadEncoded}.${signatureEncoded}`;
  }

  /**
   * Verify and parse a delegation token.
   */
  verifyToken(tokenStr: string): DelegationVerificationResult {
    const parts = tokenStr.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Malformed token structure' };
    }

    const [headerEncoded, payloadEncoded, signatureEncoded] = parts;

    // Verify signature
    const expectedSig = createHmac('sha256', this.secret)
      .update(`${headerEncoded}.${payloadEncoded}`)
      .digest();
    const expectedSigEncoded = base64UrlEncode(expectedSig);

    const sigBuf = Buffer.from(signatureEncoded);
    const expBuf = Buffer.from(expectedSigEncoded);

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: 'Invalid token cryptographic signature' };
    }

    try {
      const claims = JSON.parse(base64UrlDecode(payloadEncoded)) as DelegationClaims;

      // Expiration check
      const now = Math.floor(Date.now() / 1000);
      if (claims.expiresAt < now) {
        return { valid: false, error: 'Token expired', claims };
      }

      // Revocation check
      if (this.isRevoked(claims.tokenId)) {
        return { valid: false, error: 'Token has been revoked', claims };
      }

      return { valid: true, claims };
    } catch {
      return { valid: false, error: 'Failed to decode token claims' };
    }
  }

  /**
   * Revoke an active delegation token by its tokenId.
   */
  revokeToken(tokenId: string, reason?: string): void {
    this.revokedTokens.set(tokenId, { revokedAt: Date.now(), reason });
  }

  /**
   * Check whether a tokenId is revoked.
   */
  isRevoked(tokenId: string): boolean {
    return this.revokedTokens.has(tokenId);
  }

  /**
   * Check whether a token authorizes a specific bridge, action, and permission level.
   */
  canExecute(
    tokenStr: string,
    bridge: string,
    action: string,
    level: PermissionLevel,
  ): { allowed: boolean; reason?: string } {
    const res = this.verifyToken(tokenStr);
    if (!res.valid || !res.claims) {
      return { allowed: false, reason: res.error || 'Invalid delegation token' };
    }

    const claims = res.claims;

    // Check bridge allowance (* matches all)
    const bridgeMatch = claims.allowedBridges.includes('*') || claims.allowedBridges.includes(bridge);
    if (!bridgeMatch) {
      return { allowed: false, reason: `Bridge "${bridge}" is not permitted by delegation token` };
    }

    // Check action allowance (* matches all)
    const actionMatch = claims.allowedActions.includes('*') || claims.allowedActions.includes(action);
    if (!actionMatch) {
      return { allowed: false, reason: `Action "${action}" is not permitted by delegation token` };
    }

    // Check permission level hierarchy
    const requiredIdx = PERMISSION_HIERARCHY.indexOf(level);
    const maxIdx = PERMISSION_HIERARCHY.indexOf(claims.maxPermissionLevel);

    if (requiredIdx > maxIdx) {
      return {
        allowed: false,
        reason: `Operation level "${level}" exceeds token maximum permission level "${claims.maxPermissionLevel}"`,
      };
    }

    return { allowed: true };
  }
}
