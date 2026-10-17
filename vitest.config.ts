import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      AGENTFORGE_CREDENTIALS_DIR: join(tmpdir(), 'agentforge-vitest-sandbox-auth'),
    },
  },
});
