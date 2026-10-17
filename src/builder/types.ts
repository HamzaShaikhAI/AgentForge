import { BridgeManifest, BridgeCategory, ValidationResult } from '../types.js';

export interface BridgeGenerationRequest {
  prompt: string;
  targetName?: string;
  preferredCategory?: BridgeCategory;
  preferredTransport?: 'builtin' | 'mcp' | 'custom';
}

export type IntegrationStrategyType =
  | 'builtin-available'
  | 'mcp-available'
  | 'needs-custom-bridge'
  | 'blocked';

export interface IntegrationStrategy {
  type: IntegrationStrategyType;
  reason: string;
  matchedItem?: string;
  matchedServerId?: string;
  suggestedActions?: string[];
  requiresAuth?: boolean;
  missingRequirements?: string[];
}

export type StagedBridgeStatus =
  | 'draft'
  | 'validating'
  | 'test-failed'
  | 'awaiting-review'
  | 'registered'
  | 'blocked';

export interface SecurityFinding {
  severity: 'error' | 'warning';
  check: string;
  message: string;
  line?: number;
  codeSnippet?: string;
}

export interface SecurityAnalysisResult {
  passed: boolean;
  findings: SecurityFinding[];
  safePermissions: boolean;
  noFakeActions: boolean;
  noInjections: boolean;
  noSecretLeaks: boolean;
}

export interface BridgeTestRunResult {
  passed: boolean;
  exitCode: number;
  output: string;
  durationMs: number;
  actionsVerified: string[];
  sandboxIsolation: string;
}

export interface StagedBridge {
  id: string;
  name: string;
  status: StagedBridgeStatus;
  strategy: IntegrationStrategy;
  manifest: BridgeManifest;
  executorCode: string;
  testCode: string;
  validationResult?: ValidationResult;
  securityCheck?: SecurityAnalysisResult;
  testResult?: BridgeTestRunResult;
  stagingDir: string;
  createdAt: string;
  updatedAt: string;
  reviewNotes?: string;
  reviewedBy?: string;
}
