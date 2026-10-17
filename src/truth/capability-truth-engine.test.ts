import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityTruthEngine } from './capability-truth-engine.js';
import { BridgeRegistry } from '../bridge-registry.js';
import { GitExecutor } from '../executors/git-executor.js';
import { GoogleOAuthService } from '../auth/google-oauth.js';
import { resolve } from 'node:path';

describe('CapabilityTruthEngine (Phase 1 Truth Foundation)', () => {
  let registry: BridgeRegistry;
  let gitExecutor: GitExecutor;
  let googleOAuth: GoogleOAuthService;
  let truthEngine: CapabilityTruthEngine;

  beforeEach(async () => {
    registry = new BridgeRegistry(resolve(import.meta.dirname, '..', '..', 'bridges'));
    await registry.discover();
    gitExecutor = new GitExecutor();
    googleOAuth = new GoogleOAuthService();
    truthEngine = new CapabilityTruthEngine(registry, gitExecutor, googleOAuth);
  });

  it('correctly classifies local git capabilities as locally-verified when git is present', async () => {
    vi.spyOn(gitExecutor, 'isGitInstalled').mockResolvedValue(true);

    const statusTruth = await truthEngine.getCapabilityTruth('github', 'status-check');
    expect(statusTruth.status).toBe('locally-verified');
    expect(statusTruth.isExecutable).toBe(true);
    expect(statusTruth.permissionLevel).toBe('read');
    expect(statusTruth.requiresApproval).toBe(false);

    const changelogTruth = await truthEngine.getCapabilityTruth('github', 'changelog-prepare');
    expect(changelogTruth.status).toBe('locally-verified');
    expect(changelogTruth.isExecutable).toBe(true);
    expect(changelogTruth.permissionLevel).toBe('local-write');

    const pushTruth = await truthEngine.getCapabilityTruth('github', 'push-commits');
    expect(pushTruth.status).toBe('locally-verified');
    expect(pushTruth.isExecutable).toBe(true);
    expect(pushTruth.permissionLevel).toBe('external-write');
    expect(pushTruth.requiresApproval).toBe(true);
  });

  it('truthfully marks release-create as unsupported-or-blocked if GITHUB_TOKEN is missing', async () => {
    vi.spyOn(gitExecutor, 'isGitInstalled').mockResolvedValue(true);
    const originalToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    try {
      const releaseTruth = await truthEngine.getCapabilityTruth('github', 'release-create');
      expect(releaseTruth.status).toBe('unsupported-or-blocked');
      expect(releaseTruth.isExecutable).toBe(false);
      expect(releaseTruth.blockerReason).toContain('GITHUB_TOKEN');
    } finally {
      if (originalToken) process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it('truthfully reports blocked status when local git executable is missing', async () => {
    vi.spyOn(gitExecutor, 'isGitInstalled').mockResolvedValue(false);

    const infoTruth = await truthEngine.getCapabilityTruth('github', 'repo-info');
    expect(infoTruth.status).toBe('unsupported-or-blocked');
    expect(infoTruth.isExecutable).toBe(false);
    expect(infoTruth.blockerReason).toContain('Git CLI executable is not installed');
  });

  it('truthfully reports YouTube capabilities as blocked when Google account is disconnected', async () => {
    vi.spyOn(googleOAuth, 'getStatus').mockResolvedValue({
      accountConnected: false,
      connectedAccount: null,
      grantedScopes: [],
      clientConfigured: false,
      tokenFileExists: false,
      expired: false,
      onboardingState: 'Not configured',
      diagnosticHelp: 'Awaiting publisher configuration',
    });

    const channelTruth = await truthEngine.getCapabilityTruth('youtube', 'channel-inspect');
    expect(channelTruth.status).toBe('unsupported-or-blocked');
    expect(channelTruth.isExecutable).toBe(false);
    expect(channelTruth.blockerReason).toContain('Google account not connected');
  });

  it('truthfully reports YouTube upload as live-verified when upload scope is granted', async () => {
    vi.spyOn(googleOAuth, 'getStatus').mockResolvedValue({
      accountConnected: true,
      connectedAccount: 'test@example.com',
      grantedScopes: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.upload',
      ],
      clientConfigured: true,
      tokenFileExists: true,
      expired: false,
      onboardingState: 'Ready to connect',
      diagnosticHelp: 'Connected',
    });

    const uploadTruth = await truthEngine.getCapabilityTruth('youtube', 'video-upload');
    expect(uploadTruth.status).toBe('live-verified');
    expect(uploadTruth.isExecutable).toBe(true);
    expect(uploadTruth.permissionLevel).toBe('publish');
    expect(uploadTruth.requiresApproval).toBe(true);
  });

  it('reports unsupported-or-blocked when undeclared action is requested', async () => {
    const fakeTruth = await truthEngine.getCapabilityTruth('github', 'non-existent-action');
    expect(fakeTruth.status).toBe('unsupported-or-blocked');
    expect(fakeTruth.isExecutable).toBe(false);
  });

  it('generates an exhaustive SystemTruthReport across all bridges', async () => {
    vi.spyOn(gitExecutor, 'isGitInstalled').mockResolvedValue(true);

    const report = await truthEngine.generateSystemTruthReport();
    expect(report.summaries.length).toBeGreaterThanOrEqual(3);
    expect(report.totalDeclared).toBeGreaterThanOrEqual(16);
    expect(report.totalImplemented).toBeGreaterThanOrEqual(16);
    expect(report.timestamp).toBeDefined();

    const gitSummary = report.summaries.find(s => s.bridge === 'github');
    expect(gitSummary).toBeDefined();
    expect(gitSummary?.declaredCount).toBe(12);
  });
});
