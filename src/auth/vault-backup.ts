import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export interface VaultBackupPayload {
  version: 1;
  kdf: 'pbkdf2-sha256';
  iterations: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  exportedAt: string;
  metadata: {
    itemCount: number;
    keys: string[];
  };
}

export interface VaultInspectResult {
  valid: boolean;
  version?: number;
  itemCount?: number;
  keys?: string[];
  exportedAt?: string;
  error?: string;
}

export interface VaultImportResult {
  success: boolean;
  credentials?: Record<string, string>;
  error?: string;
}

const ITERATIONS = 100_000;
const KEY_LEN = 32;

/**
 * Encrypted Vault Backup & Restore for AgentForge credentials.
 * Provides passphrase-protected, authenticated AES-256-GCM backups.
 */
export class VaultBackupService {
  /**
   * Export credentials dictionary to an encrypted JSON backup string.
   */
  exportVault(credentials: Record<string, string>, passphrase: string): string {
    if (!passphrase || passphrase.trim().length === 0) {
      throw new Error('A non-empty passphrase is required to export encrypted vault backup');
    }

    const salt = randomBytes(16);
    const iv = randomBytes(12);

    const key = pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, 'sha256');

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify(credentials);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload: VaultBackupPayload = {
      version: 1,
      kdf: 'pbkdf2-sha256',
      iterations: ITERATIONS,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      ciphertext: ciphertext.toString('hex'),
      exportedAt: new Date().toISOString(),
      metadata: {
        itemCount: Object.keys(credentials).length,
        keys: Object.keys(credentials),
      },
    };

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Inspect metadata of an encrypted backup without decrypting it.
   */
  inspectBackup(backupJson: string): VaultInspectResult {
    try {
      const payload = JSON.parse(backupJson) as VaultBackupPayload;
      if (payload.version !== 1 || !payload.ciphertext || !payload.salt || !payload.tag) {
        return { valid: false, error: 'Invalid backup format or unsupported version' };
      }
      return {
        valid: true,
        version: payload.version,
        itemCount: payload.metadata?.itemCount ?? 0,
        keys: payload.metadata?.keys ?? [],
        exportedAt: payload.exportedAt,
      };
    } catch {
      return { valid: false, error: 'Corrupt JSON backup payload' };
    }
  }

  /**
   * Import credentials from an encrypted backup string using the passphrase.
   */
  importVault(backupJson: string, passphrase: string): VaultImportResult {
    if (!passphrase) {
      return { success: false, error: 'Passphrase is required to import vault' };
    }

    let payload: VaultBackupPayload;
    try {
      payload = JSON.parse(backupJson);
    } catch {
      return { success: false, error: 'Invalid JSON backup payload' };
    }

    if (payload.version !== 1 || !payload.ciphertext || !payload.salt || !payload.tag || !payload.iv) {
      return { success: false, error: 'Malformed vault backup structure' };
    }

    try {
      const salt = Buffer.from(payload.salt, 'hex');
      const iv = Buffer.from(payload.iv, 'hex');
      const tag = Buffer.from(payload.tag, 'hex');
      const ciphertext = Buffer.from(payload.ciphertext, 'hex');

      const key = pbkdf2Sync(passphrase, salt, payload.iterations || ITERATIONS, KEY_LEN, 'sha256');

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const credentials = JSON.parse(decrypted.toString('utf-8')) as Record<string, string>;

      return { success: true, credentials };
    } catch {
      return {
        success: false,
        error: 'Decryption failed: incorrect passphrase or corrupted backup data',
      };
    }
  }
}
