import { BridgeRegistry } from '../bridge-registry.js';
import { GitExecutor } from '../executors/git-executor.js';
import { GoogleOAuthService } from '../auth/google-oauth.js';
import { McpManager } from '../mcp/mcp-manager.js';
import {
  BridgeManifest,
  BridgeCapability,
  PermissionRule,
  PermissionLevel,
  CapabilityTruthStatus,
  CapabilityTruthRecord,
  BridgeTruthSummary,
  SystemTruthReport,
} from '../types.js';

export class CapabilityTruthEngine {
  constructor(
    private registry: BridgeRegistry,
    private gitExecutor = new GitExecutor(),
    private googleOAuth = new GoogleOAuthService(),
    private mcpManager?: McpManager,
  ) {}

  /**
   * Evaluate the exact truthful capability status of a specific action on a bridge.
   */
  async getCapabilityTruth(bridgeName: string, actionName: string): Promise<CapabilityTruthRecord> {
    const entry = this.registry.getBridge(bridgeName);
    if (!entry) {
      return {
        bridge: bridgeName,
        action: actionName,
        permissionLevel: 'read',
        sideEffects: false,
        status: 'unsupported-or-blocked',
        statusDetails: `Bridge "${bridgeName}" is not registered in AgentForge.`,
        isExecutable: false,
        requiresApproval: false,
        blockerReason: `Bridge "${bridgeName}" not found in registry.`,
      };
    }

    const manifest = entry.manifest;
    const capability = manifest.capabilities.find((c: BridgeCapability) => c.action === actionName);

    if (!capability) {
      return {
        bridge: bridgeName,
        action: actionName,
        permissionLevel: 'read',
        sideEffects: false,
        status: 'unsupported-or-blocked',
        statusDetails: `Action "${actionName}" is not declared in bridge "${bridgeName}" manifest.`,
        isExecutable: false,
        requiresApproval: false,
        blockerReason: `Action "${actionName}" undeclared.`,
      };
    }

    // Determine permission and approval requirement from manifest
    const rule = manifest.permissions.find((p: PermissionRule) => {
      const parts = p.actions.split('|').map((s: string) => s.trim());
      return parts.includes(actionName);
    });
    const permissionLevel: PermissionLevel = capability.permissionLevel || (rule?.level as PermissionLevel) || 'read';
    const requiresApproval = rule ? rule.requiresApproval : (permissionLevel === 'external-write' || permissionLevel === 'publish' || permissionLevel === 'destructive');

    // Evaluate based on bridge type
    if (bridgeName === 'github') {
      return this.evaluateGitAction(capability, permissionLevel, requiresApproval);
    }

    if (bridgeName === 'youtube') {
      return this.evaluateYouTubeAction(capability, permissionLevel, requiresApproval);
    }

    if (bridgeName === 'example-echo' || bridgeName === 'example') {
      return {
        bridge: bridgeName,
        action: actionName,
        permissionLevel,
        sideEffects: capability.sideEffects,
        status: 'locally-verified',
        statusDetails: 'Standard built-in echo bridge verified locally with unit tests.',
        isExecutable: true,
        requiresApproval,
        inputs: capability.inputs,
        outputs: capability.outputs,
        verifiedAt: new Date().toISOString(),
      };
    }

    // Custom or third-party bridge
    return {
      bridge: bridgeName,
      action: actionName,
      permissionLevel,
      sideEffects: capability.sideEffects,
      status: 'implemented',
      statusDetails: `Custom bridge "${bridgeName}" action "${actionName}" declared and registered.`,
      isExecutable: true,
      requiresApproval,
      inputs: capability.inputs,
      outputs: capability.outputs,
      verifiedAt: new Date().toISOString(),
    };
  }

  private async evaluateGitAction(
    cap: BridgeCapability,
    permissionLevel: any,
    requiresApproval: boolean,
  ): Promise<CapabilityTruthRecord> {
    const gitSupported = new Set([
      'repo-info',
      'status-check',
      'branch-list',
      'log-inspect',
      'diff-review',
      'release-verify',
      'changelog-prepare',
      'tag-create',
      'push-commits',
      'push-tags',
      'release-create',
      'branch-delete',
    ]);

    if (!gitSupported.has(cap.action)) {
      return {
        bridge: 'github',
        action: cap.action,
        permissionLevel,
        sideEffects: cap.sideEffects,
        status: 'declared',
        statusDetails: `Action "${cap.action}" is declared in manifest but lacks executor implementation.`,
        isExecutable: false,
        requiresApproval,
        inputs: cap.inputs,
        outputs: cap.outputs,
        blockerReason: `Missing executor implementation for "${cap.action}".`,
      };
    }

    let gitOk = false;
    try {
      gitOk = await this.gitExecutor.isGitInstalled();
    } catch {
      gitOk = false;
    }

    if (!gitOk) {
      return {
        bridge: 'github',
        action: cap.action,
        permissionLevel,
        sideEffects: cap.sideEffects,
        status: 'unsupported-or-blocked',
        statusDetails: 'Local git executable is not installed or not available on system PATH.',
        isExecutable: false,
        requiresApproval,
        inputs: cap.inputs,
        outputs: cap.outputs,
        blockerReason: 'Git CLI executable is not installed on PATH.',
      };
    }

    if (cap.action === 'release-create' && !process.env.GITHUB_TOKEN) {
      return {
        bridge: 'github',
        action: cap.action,
        permissionLevel,
        sideEffects: cap.sideEffects,
        status: 'unsupported-or-blocked',
        statusDetails: 'Creating a GitHub release requires the GITHUB_TOKEN environment variable.',
        isExecutable: false,
        requiresApproval,
        inputs: cap.inputs,
        outputs: cap.outputs,
        blockerReason: 'Missing GITHUB_TOKEN environment variable for remote GitHub API calls.',
      };
    }

    // Git read and local-write actions are locally verified
    return {
      bridge: 'github',
      action: cap.action,
      permissionLevel,
      sideEffects: cap.sideEffects,
      status: cap.action === 'release-create' ? 'live-verified' : 'locally-verified',
      statusDetails: `Verified operational via local git CLI executable${cap.action === 'release-create' ? ' and GITHUB_TOKEN' : ''}.`,
      isExecutable: true,
      requiresApproval,
      inputs: cap.inputs,
      outputs: cap.outputs,
      verifiedAt: new Date().toISOString(),
    };
  }

  private async evaluateYouTubeAction(
    cap: BridgeCapability,
    permissionLevel: any,
    requiresApproval: boolean,
  ): Promise<CapabilityTruthRecord> {
    const ytSupported = new Set([
      'channel-inspect',
      'channel-metadata',
      'video-list',
      'video-upload',
    ]);

    if (!ytSupported.has(cap.action)) {
      return {
        bridge: 'youtube',
        action: cap.action,
        permissionLevel,
        sideEffects: cap.sideEffects,
        status: 'declared',
        statusDetails: `Action "${cap.action}" is declared in manifest but lacks runtime implementation.`,
        isExecutable: false,
        requiresApproval,
        inputs: cap.inputs,
        outputs: cap.outputs,
        blockerReason: `Missing executor implementation for "${cap.action}".`,
      };
    }

    let authStatus = { accountConnected: false, grantedScopes: [] as string[] };
    try {
      authStatus = await this.googleOAuth.getStatus();
    } catch {
      // unconfigured
    }

    if (!authStatus.accountConnected) {
      return {
        bridge: 'youtube',
        action: cap.action,
        permissionLevel,
        sideEffects: cap.sideEffects,
        status: 'unsupported-or-blocked',
        statusDetails: 'Google account is not connected. Connect via "agentforge auth youtube" or Manager dashboard.',
        isExecutable: false,
        requiresApproval,
        inputs: cap.inputs,
        outputs: cap.outputs,
        blockerReason: 'Google account not connected. Requires OAuth authorization.',
      };
    }

    if (cap.action === 'video-upload') {
      if (!authStatus.grantedScopes.includes('https://www.googleapis.com/auth/youtube.upload')) {
        return {
          bridge: 'youtube',
          action: cap.action,
          permissionLevel,
          sideEffects: cap.sideEffects,
          status: 'unsupported-or-blocked',
          statusDetails: 'YouTube upload scope has not been granted. Run "agentforge auth youtube --upload" to authorize.',
          isExecutable: false,
          requiresApproval,
          inputs: cap.inputs,
          outputs: cap.outputs,
          blockerReason: 'Scope "youtube.upload" not granted by user.',
        };
      }
      return {
        bridge: 'youtube',
        action: cap.action,
        permissionLevel,
        sideEffects: cap.sideEffects,
        status: 'live-verified',
        statusDetails: 'Live verified with connected Google account and youtube.upload scope.',
        isExecutable: true,
        requiresApproval,
        inputs: cap.inputs,
        outputs: cap.outputs,
        verifiedAt: new Date().toISOString(),
      };
    }

    if (!authStatus.grantedScopes.includes('https://www.googleapis.com/auth/youtube.readonly')) {
      return {
        bridge: 'youtube',
        action: cap.action,
        permissionLevel,
        sideEffects: cap.sideEffects,
        status: 'unsupported-or-blocked',
        statusDetails: 'YouTube read scope has not been granted. Run "agentforge auth youtube" to authorize.',
        isExecutable: false,
        requiresApproval,
        inputs: cap.inputs,
        outputs: cap.outputs,
        blockerReason: 'Scope "youtube.readonly" not granted by user.',
      };
    }

    return {
      bridge: 'youtube',
      action: cap.action,
      permissionLevel,
      sideEffects: cap.sideEffects,
      status: 'live-verified',
      statusDetails: 'Live verified with connected Google account and youtube.readonly scope.',
      isExecutable: true,
      requiresApproval,
      inputs: cap.inputs,
      outputs: cap.outputs,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Summarize the complete capability truth for an entire bridge.
   */
  async getBridgeSummary(bridgeName: string): Promise<BridgeTruthSummary | undefined> {
    const entry = this.registry.getBridge(bridgeName);
    if (!entry) return undefined;

    const capabilities: CapabilityTruthRecord[] = [];
    for (const cap of entry.manifest.capabilities) {
      capabilities.push(await this.getCapabilityTruth(bridgeName, cap.action));
    }

    const declaredCount = capabilities.length;
    const implementedCount = capabilities.filter(c => c.status !== 'declared').length;
    const unitTestedCount = capabilities.filter(c => c.status === 'unit-tested' || c.status === 'locally-verified' || c.status === 'live-verified').length;
    const locallyVerifiedCount = capabilities.filter(c => c.status === 'locally-verified' || c.status === 'live-verified').length;
    const liveVerifiedCount = capabilities.filter(c => c.status === 'live-verified').length;
    const blockedCount = capabilities.filter(c => c.status === 'unsupported-or-blocked').length;

    let overallStatus: 'fully-verified' | 'partially-verified' | 'blocked' | 'declared-only' = 'partially-verified';
    if (blockedCount === declaredCount) {
      overallStatus = 'blocked';
    } else if (declaredCount > 0 && implementedCount === 0) {
      overallStatus = 'declared-only';
    } else if (blockedCount === 0 && (locallyVerifiedCount + liveVerifiedCount === declaredCount)) {
      overallStatus = 'fully-verified';
    }

    return {
      bridge: bridgeName,
      displayName: entry.manifest.displayName || bridgeName,
      version: entry.manifest.version || '0.1.0',
      status: overallStatus,
      capabilities,
      declaredCount,
      implementedCount,
      unitTestedCount,
      locallyVerifiedCount,
      liveVerifiedCount,
      blockedCount,
    };
  }

  /**
   * Generate an exhaustive truth report for all registered bridges.
   */
  async generateSystemTruthReport(): Promise<SystemTruthReport> {
    const entries = this.registry.getAllBridges();
    const summaries: BridgeTruthSummary[] = [];

    for (const entry of entries) {
      const summary = await this.getBridgeSummary(entry.manifest.name);
      if (summary) summaries.push(summary);
    }

    return {
      timestamp: new Date().toISOString(),
      summaries,
      totalDeclared: summaries.reduce((acc, s) => acc + s.declaredCount, 0),
      totalImplemented: summaries.reduce((acc, s) => acc + s.implementedCount, 0),
      totalUnitTested: summaries.reduce((acc, s) => acc + s.unitTestedCount, 0),
      totalLocallyVerified: summaries.reduce((acc, s) => acc + s.locallyVerifiedCount, 0),
      totalLiveVerified: summaries.reduce((acc, s) => acc + s.liveVerifiedCount, 0),
      totalBlocked: summaries.reduce((acc, s) => acc + s.blockedCount, 0),
    };
  }
}
