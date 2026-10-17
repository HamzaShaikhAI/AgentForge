import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryCredentialStore,
  EncryptedFileCredentialStore,
  WindowsDpapiCredentialStore,
} from './credential-store.js';
import { StoredCredentials } from './types.js';

describe('Credential Storage Security & Integrity', () => {
  let tempDir: string;

  const sampleCreds: StoredCredentials = {
    provider: 'google',
    refreshToken: '1//sample-refresh-token-xyz',
    accessToken: 'ya29.sample-access-token-abc',
    expiresAt: Date.now() + 3600000,
    scopes: ['openid', 'email', 'profile'],
    userEmail: 'dev@example.com',
    userId: '123456789',
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentforge-test-auth-'));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('MemoryCredentialStore', () => {
    it('saves, loads, and deletes credentials in memory', async () => {
      const store = new MemoryCredentialStore();
      expect(await store.load('google')).toBeNull();

      await store.save('google', sampleCreds);
      const loaded = await store.load('google');
      expect(loaded).toEqual(sampleCreds);

      const deleted = await store.delete('google');
      expect(deleted).toBe(true);
      expect(await store.load('google')).toBeNull();
    });
  });

  describe('EncryptedFileCredentialStore', () => {
    it('persists encrypted payload to disk (never plaintext JSON)', async () => {
      const store = new EncryptedFileCredentialStore(tempDir, 'test-master-key');
      await store.save('google', sampleCreds);

      // Verify the file exists and is encrypted
      const filePath = join(tempDir, 'google.enc');
      const fileBytes = await readFile(filePath);
      const fileText = fileBytes.toString('utf-8');

      // Invariant: The raw file MUST NOT contain plaintext tokens or emails
      expect(fileText).not.toContain('sample-refresh-token-xyz');
      expect(fileText).not.toContain('ya29.sample-access-token-abc');
      expect(fileText).not.toContain('dev@example.com');

      // Load back through store
      const loaded = await store.load('google');
      expect(loaded).toEqual(sampleCreds);
    });

    it('handles corrupted data or decryption failures gracefully', async () => {
      const store = new EncryptedFileCredentialStore(tempDir, 'test-master-key');
      const filePath = join(tempDir, 'google.enc');
      await writeFile(filePath, Buffer.from('corrupted-data-header-padding-too-short'));

      const loaded = await store.load('google');
      expect(loaded).toBeNull();
    });

    it('returns false when deleting non-existent provider', async () => {
      const store = new EncryptedFileCredentialStore(tempDir, 'test-master-key');
      const deleted = await store.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('WindowsDpapiCredentialStore', () => {
    it.skipIf(process.platform !== 'win32')(
      'encrypts credentials using Windows DPAPI',
      async () => {
        const store = new WindowsDpapiCredentialStore(tempDir);
        expect(store.isAvailable()).toBe(true);

        await store.save('google', sampleCreds);

        const filePath = join(tempDir, 'google.dat');
        const cipherText = await readFile(filePath, 'utf-8');

        // Invariant: File on disk is protected base64, never plaintext
        expect(cipherText).not.toContain('sample-refresh-token-xyz');
        expect(cipherText).not.toContain('dev@example.com');
        expect(cipherText).toMatch(/^[A-Za-z0-9+/=]+$/);

        // Successfully decrypts for current user
        const loaded = await store.load('google');
        expect(loaded).toEqual(sampleCreds);

        // Deletes file cleanly
        const deleted = await store.delete('google');
        expect(deleted).toBe(true);
        expect(await store.load('google')).toBeNull();
      },
      30000,
    );
  });
});
