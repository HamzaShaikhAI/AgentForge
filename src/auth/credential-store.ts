/**
 * Credential Storage Implementations
 * Provides secure, OS-protected storage for refresh tokens and OAuth credentials outside the repository.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { CredentialStore, StoredCredentials } from './types.js';

export function getAgentForgeDataDir(): string {
  if (process.env.AGENTFORGE_CREDENTIALS_DIR) {
    return process.env.AGENTFORGE_CREDENTIALS_DIR;
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || process.env.USERPROFILE || 'C:\\';
    return join(base, 'AgentForge', 'auth');
  }
  const home = process.env.HOME || '/tmp';
  return join(home, '.config', 'agentforge', 'auth');
}

/**
 * Windows Data Protection API (DPAPI) Credential Store
 * Encrypts secrets using the logged-in Windows user's master key.
 * Secrets are passed via stdin to prevent exposure in process argument listings.
 */
export class WindowsDpapiCredentialStore implements CredentialStore {
  constructor(private storageDir = getAgentForgeDataDir()) {}

  getBackendName(): 'windows-dpapi' {
    return 'windows-dpapi';
  }

  isAvailable(): boolean {
    return process.platform === 'win32';
  }

  private getFilePath(provider: string): string {
    const safeProvider = provider.replace(/[^a-zA-Z0-9_-]/g, '');
    return join(this.storageDir, `${safeProvider}.dat`);
  }

  private async executePowerShell(command: string, stdinData: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', chunk => {
        stdout += chunk.toString('utf-8');
      });

      ps.stderr.on('data', chunk => {
        stderr += chunk.toString('utf-8');
      });

      ps.on('error', reject);

      ps.on('close', code => {
        if (code !== 0) {
          reject(new Error(`PowerShell DPAPI failed (exit code ${code}): ${stderr.trim()}`));
        } else {
          resolve(stdout.trim());
        }
      });

      ps.stdin.write(stdinData);
      ps.stdin.end();
    });
  }

  async save(provider: string, creds: StoredCredentials): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    const jsonStr = JSON.stringify(creds);

    const script = `
      Add-Type -AssemblyName System.Security
      $inputStr = $input | Out-String
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($inputStr.TrimEnd())
      $enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [System.Convert]::ToBase64String($enc)
    `;

    const encryptedBase64 = await this.executePowerShell(script, jsonStr);
    const filePath = this.getFilePath(provider);
    await writeFile(filePath, encryptedBase64, { encoding: 'utf-8', mode: 0o600 });
  }

  async load(provider: string): Promise<StoredCredentials | null> {
    const filePath = this.getFilePath(provider);
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const encryptedBase64 = await readFile(filePath, 'utf-8');
      if (!encryptedBase64.trim()) return null;

      const script = `
        Add-Type -AssemblyName System.Security
        $inputStr = $input | Out-String
        $bytes = [System.Convert]::FromBase64String($inputStr.Trim())
        $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        [System.Text.Encoding]::UTF8.GetString($dec)
      `;

      const decryptedJson = await this.executePowerShell(script, encryptedBase64);
      return JSON.parse(decryptedJson) as StoredCredentials;
    } catch {
      // If decryption fails (e.g. file corrupted or different user), safely report null
      return null;
    }
  }

  async delete(provider: string): Promise<boolean> {
    const filePath = this.getFilePath(provider);
    if (existsSync(filePath)) {
      try {
        await unlink(filePath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/**
 * Cross-platform Encrypted File Store using AES-256-GCM.
 * Used on non-Windows platforms or as a fallback.
 */
export class EncryptedFileCredentialStore implements CredentialStore {
  constructor(
    private storageDir = getAgentForgeDataDir(),
    private masterSecret = process.env.AGENTFORGE_STORE_KEY || 'agentforge-local-auth-fallback-salt',
  ) {}

  getBackendName(): 'encrypted-file' {
    return 'encrypted-file';
  }

  isAvailable(): boolean {
    return true;
  }

  private getFilePath(provider: string): string {
    const safeProvider = provider.replace(/[^a-zA-Z0-9_-]/g, '');
    return join(this.storageDir, `${safeProvider}.enc`);
  }

  private deriveKey(salt: Buffer): Buffer {
    return scryptSync(this.masterSecret, salt, 32);
  }

  async save(provider: string, creds: StoredCredentials): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    const jsonStr = JSON.stringify(creds);

    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = this.deriveKey(salt);

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: [16 bytes salt][12 bytes iv][16 bytes auth tag][encrypted data]
    const payload = Buffer.concat([salt, iv, tag, encrypted]);
    const filePath = this.getFilePath(provider);
    await writeFile(filePath, payload, { mode: 0o600 });
  }

  async load(provider: string): Promise<StoredCredentials | null> {
    const filePath = this.getFilePath(provider);
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const buffer = await readFile(filePath);
      if (buffer.length < 44) return null; // salt(16) + iv(12) + tag(16)

      const salt = buffer.subarray(0, 16);
      const iv = buffer.subarray(16, 28);
      const tag = buffer.subarray(28, 44);
      const encrypted = buffer.subarray(44);

      const key = this.deriveKey(salt);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
      return JSON.parse(decrypted) as StoredCredentials;
    } catch {
      return null;
    }
  }

  async delete(provider: string): Promise<boolean> {
    const filePath = this.getFilePath(provider);
    if (existsSync(filePath)) {
      try {
        await unlink(filePath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/**
 * In-memory Credential Store for testing and mock environments.
 */
export class MemoryCredentialStore implements CredentialStore {
  private store = new Map<string, StoredCredentials>();

  getBackendName(): 'memory' {
    return 'memory';
  }

  isAvailable(): boolean {
    return true;
  }

  async save(provider: string, creds: StoredCredentials): Promise<void> {
    this.store.set(provider, { ...creds });
  }

  async load(provider: string): Promise<StoredCredentials | null> {
    const found = this.store.get(provider);
    return found ? { ...found } : null;
  }

  async delete(provider: string): Promise<boolean> {
    return this.store.delete(provider);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Factory for selecting the optimal available store for the host OS.
 */
export function getDefaultCredentialStore(): CredentialStore {
  if (process.platform === 'win32') {
    return new WindowsDpapiCredentialStore();
  }
  return new EncryptedFileCredentialStore();
}
