import { describe, it, expect, vi } from 'vitest';
import { StandardStepExecutor } from './executors/index.js';
import { WorkflowStep } from './types.js';

describe('StandardStepExecutor — Point-of-Execution Hardening (Phase 1)', () => {
  it('rejects missing or invalid required input parameters before execution', async () => {
    const executor = new StandardStepExecutor();

    const commitStep: WorkflowStep = {
      id: 'step-commit',
      name: 'Commit Changes',
      bridge: 'github',
      action: 'commit',
      inputs: {},
    };

    await expect(executor.execute(commitStep, {})).rejects.toThrow(
      'Input validation failed: action "commit" on bridge "github" requires a non-empty string for "message"'
    );

    const uploadStep: WorkflowStep = {
      id: 'step-upload',
      name: 'Upload Video',
      bridge: 'youtube',
      action: 'video-upload',
      inputs: { filePath: 'test.mp4' }, // missing title
    };

    await expect(executor.execute(uploadStep, { filePath: 'test.mp4' })).rejects.toThrow(
      'Input validation failed: action "video-upload" on bridge "youtube" requires a non-empty string for "title"'
    );
  });

  it('aborts execution when step.timeoutMs is exceeded', async () => {
    const executor = new StandardStepExecutor();

    // Register a custom mock executor that hangs
    executor.registerCustomExecutor('mock-slow-bridge', {
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { completed: true };
      },
    });

    const slowStep: WorkflowStep = {
      id: 'step-slow',
      name: 'Slow Step',
      bridge: 'mock-slow-bridge',
      action: 'slow-action',
      inputs: {},
      timeoutMs: 50, // 50ms timeout < 500ms duration
    };

    await expect(executor.execute(slowStep, {})).rejects.toThrow(
      'Action "slow-action" on bridge "mock-slow-bridge" timed out after 50ms'
    );
  });

  it('redacts sensitive tokens and secrets from step output objects', async () => {
    const executor = new StandardStepExecutor();

    executor.registerCustomExecutor('auth-bridge', {
      execute: async () => {
        return {
          status: 'ok',
          user: 'developer',
          access_token: 'ya29.a0AfH6SM...super-secret-access-token',
          nested: {
            client_secret: 'GOCSPX-secret12345',
            safeValue: 100,
          },
        };
      },
    });

    const authStep: WorkflowStep = {
      id: 'step-auth',
      name: 'Auth Step',
      bridge: 'auth-bridge',
      action: 'get-credentials',
      inputs: {},
    };

    const result = (await executor.execute(authStep, {})) as Record<string, any>;
    expect(result.status).toBe('ok');
    expect(result.user).toBe('developer');
    expect(result.access_token).toBe('[REDACTED]');
    expect(result.nested.client_secret).toBe('[REDACTED]');
    expect(result.nested.safeValue).toBe(100);
  });

  it('sanitizes sensitive tokens in thrown error messages', async () => {
    const executor = new StandardStepExecutor();

    executor.registerCustomExecutor('failing-bridge', {
      execute: async () => {
        throw new Error('OAuth failed: ya29.secretToken1234567890 was rejected by endpoint');
      },
    });

    const failingStep: WorkflowStep = {
      id: 'step-fail',
      name: 'Failing Step',
      bridge: 'failing-bridge',
      action: 'fail-action',
      inputs: {},
    };

    await expect(executor.execute(failingStep, {})).rejects.toThrow(
      'OAuth failed: [REDACTED_ACCESS_TOKEN] was rejected by endpoint'
    );
  });
});
