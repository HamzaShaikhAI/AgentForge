import { createHash } from 'node:crypto';

export interface AuditBlock {
  index: number;
  timestamp: string;
  eventType: string;
  actor: string;
  details: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface AuditVerificationResult {
  valid: boolean;
  compromisedIndex?: number;
  reason?: string;
  totalBlocks: number;
}

export interface AuditQueryFilter {
  eventType?: string;
  actor?: string;
  since?: string;
  until?: string;
}

export const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

/**
 * Deterministically sort object keys for reproducible hashing.
 */
function canonicalJson(obj: unknown): string {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`);
  return '{' + entries.join(',') + '}';
}

/**
 * Compute the SHA-256 hash of an audit block's content.
 */
export function calculateBlockHash(
  index: number,
  timestamp: string,
  eventType: string,
  actor: string,
  details: Record<string, unknown>,
  previousHash: string,
): string {
  const content = `${index}:${timestamp}:${eventType}:${actor}:${canonicalJson(details)}:${previousHash}`;
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Cryptographic Hash-Chain Audit Log for AgentForge.
 * Guarantees tamper-evident audit recording of all security, permission,
 * and execution events.
 */
export class AuditChain {
  private chain: AuditBlock[] = [];

  constructor(initialBlocks?: AuditBlock[]) {
    if (initialBlocks && initialBlocks.length > 0) {
      this.chain = [...initialBlocks];
    }
  }

  /**
   * Append a new audit event to the tamper-evident chain.
   */
  append(eventType: string, actor: string, details: Record<string, unknown> = {}): AuditBlock {
    const index = this.chain.length;
    const timestamp = new Date().toISOString();
    const previousHash = index === 0 ? GENESIS_PREVIOUS_HASH : this.chain[index - 1].hash;
    const hash = calculateBlockHash(index, timestamp, eventType, actor, details, previousHash);

    const block: AuditBlock = {
      index,
      timestamp,
      eventType,
      actor,
      details,
      previousHash,
      hash,
    };

    this.chain.push(block);
    return block;
  }

  /**
   * Verify the cryptographic integrity of the entire audit chain.
   */
  verifyIntegrity(): AuditVerificationResult {
    if (this.chain.length === 0) {
      return { valid: true, totalBlocks: 0 };
    }

    for (let i = 0; i < this.chain.length; i++) {
      const block = this.chain[i];

      // 1. Check index sequence
      if (block.index !== i) {
        return {
          valid: false,
          compromisedIndex: i,
          reason: `Invalid index sequence: expected ${i}, found ${block.index}`,
          totalBlocks: this.chain.length,
        };
      }

      // 2. Check previous hash linkage
      const expectedPrevHash = i === 0 ? GENESIS_PREVIOUS_HASH : this.chain[i - 1].hash;
      if (block.previousHash !== expectedPrevHash) {
        return {
          valid: false,
          compromisedIndex: i,
          reason: `Broken chain link at index ${i}: previousHash mismatch`,
          totalBlocks: this.chain.length,
        };
      }

      // 3. Recompute and verify block hash
      const computedHash = calculateBlockHash(
        block.index,
        block.timestamp,
        block.eventType,
        block.actor,
        block.details,
        block.previousHash,
      );

      if (block.hash !== computedHash) {
        return {
          valid: false,
          compromisedIndex: i,
          reason: `Tampered block data at index ${i}: hash mismatch`,
          totalBlocks: this.chain.length,
        };
      }
    }

    return { valid: true, totalBlocks: this.chain.length };
  }

  /**
   * Get all entries in the audit chain.
   */
  getEntries(): AuditBlock[] {
    return [...this.chain];
  }

  /**
   * Query audit entries by eventType, actor, or date range.
   */
  query(filter: AuditQueryFilter): AuditBlock[] {
    return this.chain.filter(block => {
      if (filter.eventType && block.eventType !== filter.eventType) return false;
      if (filter.actor && block.actor !== filter.actor) return false;
      if (filter.since && new Date(block.timestamp) < new Date(filter.since)) return false;
      if (filter.until && new Date(block.timestamp) > new Date(filter.until)) return false;
      return true;
    });
  }

  /**
   * Export the chain as a serialized JSON string.
   */
  exportJson(): string {
    return JSON.stringify(this.chain, null, 2);
  }

  /**
   * Import an existing chain from a JSON string, verifying integrity.
   */
  importJson(jsonStr: string): { imported: number; valid: boolean; error?: string } {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) {
        return { imported: 0, valid: false, error: 'Import payload must be an array of blocks' };
      }

      const tempChain = new AuditChain(parsed as AuditBlock[]);
      const verifyRes = tempChain.verifyIntegrity();
      if (!verifyRes.valid) {
        return { imported: 0, valid: false, error: verifyRes.reason };
      }

      this.chain = parsed as AuditBlock[];
      return { imported: this.chain.length, valid: true };
    } catch (err) {
      return { imported: 0, valid: false, error: (err as Error).message };
    }
  }
}
