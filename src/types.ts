/**
 * AgentForge Core Types
 * Bridge definitions, workflow state, permissions, and execution results.
 */

// ─── Bridge Manifest ───────────────────────────────────────────────

export interface BridgeManifest {
  /** Schema version for forward compatibility */
  schema: '1.0';
  /** Unique identifier, lowercase kebab-case */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** What this bridge does */
  description: string;
  /** Semver version */
  version: string;
  /** Author or maintainer */
  author?: string;
  /** Bridge category */
  category?: BridgeCategory;
  /** Capabilities this bridge provides */
  capabilities: BridgeCapability[];
  /** External integrations required */
  integrations: IntegrationRequirement[];
  /** Authentication requirements (never stores actual secrets) */
  auth: AuthRequirement[];
  /** Permission levels for different operations */
  permissions: PermissionRule[];
  /** Input/output schemas for capabilities */
  schemas?: Record<string, IOSchema>;
  /** Compatibility information */
  compatibility?: CompatibilityInfo;
  /** How to test/verify this bridge works */
  test?: TestSpec;
  /** Tags for discovery */
  tags?: string[];
}

export type BridgeCategory =
  | 'source-control'
  | 'ci-cd'
  | 'communication'
  | 'content-creation'
  | 'social-media'
  | 'cloud-services'
  | 'productivity'
  | 'development'
  | 'media'
  | 'other';

export interface BridgeCapability {
  /** Unique action identifier */
  action: string;
  /** Human-readable description */
  description: string;
  /** Permission level required */
  permissionLevel: PermissionLevel;
  /** Whether this action has side effects */
  sideEffects: boolean;
  /** Input parameters */
  inputs?: SchemaField[];
  /** Output fields */
  outputs?: SchemaField[];
}

export interface IntegrationRequirement {
  /** Integration name (e.g., 'git', 'github-cli', 'github-api') */
  name: string;
  /** How to check if it's available */
  check: IntegrationCheck;
  /** Is this required or optional? */
  required: boolean;
  /** Instructions for setting up */
  setupInstructions?: string;
}

export interface IntegrationCheck {
  /** Type of check */
  type: 'command' | 'env-var' | 'file' | 'mcp-server';
  /** Value to check (command to run, env var name, file path, server name) */
  value: string;
  /** Expected pattern in output (regex) */
  expectedPattern?: string;
}

export interface AuthRequirement {
  /** Auth method identifier */
  name: string;
  /** Type of authentication */
  type: 'env-var' | 'oauth' | 'token-file' | 'cli-auth' | 'api-key';
  /** Environment variable name (for env-var type) */
  envVar?: string;
  /** Description of what this auth provides */
  description: string;
  /** Is this auth required? */
  required: boolean;
  /** Scopes or permissions needed */
  scopes?: string[];
}

// ─── Permissions ───────────────────────────────────────────────────

export type PermissionLevel = 'read' | 'local-write' | 'external-write' | 'publish' | 'destructive';

export interface PermissionRule {
  /** Which actions this rule applies to (glob pattern) */
  actions: string;
  /** Permission level */
  level: PermissionLevel;
  /** Whether explicit approval is required */
  requiresApproval: boolean;
  /** Reason shown when asking for approval */
  approvalReason?: string;
}

export const PERMISSION_HIERARCHY: PermissionLevel[] = [
  'read',
  'local-write',
  'external-write',
  'publish',
  'destructive',
];

// ─── Schemas ───────────────────────────────────────────────────────

export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface IOSchema {
  input?: SchemaField[];
  output?: SchemaField[];
}

// ─── Compatibility ─────────────────────────────────────────────────

export interface CompatibilityInfo {
  /** Supported platforms */
  platforms?: ('windows' | 'macos' | 'linux')[];
  /** Minimum AgentForge version */
  minAgentForgeVersion?: string;
  /** Required runtime tools */
  requiredTools?: string[];
}

// ─── Testing ───────────────────────────────────────────────────────

export interface TestSpec {
  /** Command to run for smoke test */
  smokeTest?: string;
  /** How to verify the bridge is functional */
  verificationSteps?: string[];
}

// ─── Workflow ──────────────────────────────────────────────────────

export interface WorkflowDefinition {
  /** Unique workflow identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Ordered steps */
  steps: WorkflowStep[];
  /** When this workflow was created */
  createdAt?: string;
}

export interface WorkflowStep {
  /** Step identifier */
  id: string;
  /** Human-readable step name */
  name: string;
  /** Which bridge capability to invoke */
  bridge: string;
  /** Which action on the bridge */
  action: string;
  /** Input parameters */
  inputs: Record<string, unknown>;
  /** Steps that must complete before this one */
  dependsOn?: string[];
  /** Whether to retry on failure */
  retryable?: boolean;
  /** Max retry attempts */
  maxRetries?: number;
  /** Optional delay in ms between retries */
  retryDelayMs?: number;
  /** Whether the action is explicitly established as idempotent and safe to retry even if publish/destructive */
  safeToRetry?: boolean;
  /** Optional execution timeout in milliseconds for this step */
  timeoutMs?: number;
  /** Optional condition expression to evaluate before step executes */
  condition?: string;
  /** Whether this step is a cleanup step that runs during workflow cancellation or failure */
  cleanup?: boolean;
  /** Whether to stop workflow on failure */
  stopOnFailure?: boolean;
}

// ─── Execution ─────────────────────────────────────────────────────

export type StepStatus =
  | 'pending'
  | 'waiting-approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'needs_reconciliation';

export interface StepResult {
  stepId: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalRequestId?: string;
  attempts?: number;
  inputs?: Record<string, unknown>;
  reconciliation?: ReconciliationContext;
}

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'paused_for_approval'
  | 'cancelled'
  | 'needs_reconciliation';

export interface ReconciliationContext {
  stepId: string;
  action: string;
  bridge: string;
  sideEffects: boolean;
  detectedAt: string;
  reason: string;
  error?: string;
  inputs?: Record<string, unknown>;
  suggestedAction: string;
  options: Array<'verify_remote_state' | 'mark_completed' | 'mark_failed' | 'retry_after_verification'>;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionDecision?: string;
  resolutionNotes?: string;
}

export interface ApprovalCheckpoint {
  approvalRequestId: string;
  runId: string;
  stepId: string;
  provider: string;
  action: string;
  permissionLevel: PermissionLevel;
  inputs: Record<string, unknown>;
  approvalReason: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
}

export interface WorkflowDryRunStep {
  stepId: string;
  name: string;
  bridge: string;
  action: string;
  permissionLevel: PermissionLevel;
  requiresApproval: boolean;
  approvalReason?: string;
  missingCredentials: string[];
  isNonIdempotent: boolean;
  timeoutMs: number;
  condition?: string;
  cleanup?: boolean;
}

export interface WorkflowDryRunResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  steps: WorkflowDryRunStep[];
}

export interface WorkflowRun {
  /** Unique run identifier */
  runId: string;
  /** Which workflow */
  workflowId: string;
  /** Current status */
  status: WorkflowRunStatus;
  /** Step results */
  steps: StepResult[];
  /** When the run started */
  startedAt: string;
  /** When the run completed */
  completedAt?: string;
  /** Error if the run failed */
  error?: string;
  /** Active approval checkpoint if paused for approval */
  pendingApproval?: ApprovalCheckpoint;
  /** Active reconciliation context if paused due to ambiguous outcome */
  reconciliation?: ReconciliationContext;
}

// ─── Capability Truth Engine Types ──────────────────────────────────

export type CapabilityTruthStatus =
  | 'declared'               // Declared in manifest schema, no runtime code yet
  | 'implemented'            // Runtime executor code exists
  | 'unit-tested'            // Automated test suite coverage verified
  | 'locally-verified'       // Local prerequisites (system CLI, disk, DPAPI) verified operational
  | 'live-verified'          // Verified against real live remote provider endpoint with valid credentials
  | 'unsupported-or-blocked'; // Missing prerequisite, missing API key, unverified client, or platform incompatibility

export interface CapabilityTruthRecord {
  bridge: string;
  action: string;
  permissionLevel: PermissionLevel;
  sideEffects: boolean;
  status: CapabilityTruthStatus;
  statusDetails: string;
  isExecutable: boolean;
  requiresApproval: boolean;
  inputs?: SchemaField[];
  outputs?: SchemaField[];
  verifiedAt?: string;
  blockerReason?: string;
}

export interface BridgeTruthSummary {
  bridge: string;
  displayName: string;
  version: string;
  status: 'fully-verified' | 'partially-verified' | 'blocked' | 'declared-only';
  capabilities: CapabilityTruthRecord[];
  declaredCount: number;
  implementedCount: number;
  unitTestedCount: number;
  locallyVerifiedCount: number;
  liveVerifiedCount: number;
  blockedCount: number;
}

export interface SystemTruthReport {
  timestamp: string;
  summaries: BridgeTruthSummary[];
  totalDeclared: number;
  totalImplemented: number;
  totalUnitTested: number;
  totalLocallyVerified: number;
  totalLiveVerified: number;
  totalBlocked: number;
}

// ─── Point-of-Execution Audit Types ────────────────────────────────

export interface ExecutionAuditRecord {
  id: string;
  timestamp: string;
  bridge: string;
  action: string;
  permissionLevel: PermissionLevel;
  requiresApproval: boolean;
  approvedBy?: string;
  inputHash: string;
  durationMs: number;
  success: boolean;
  error?: string;
  caller?: string;
}

// ─── Bridge Registry ───────────────────────────────────────────────

export interface BridgeRegistryEntry {
  manifest: BridgeManifest;
  /** File path to the bridge manifest */
  path: string;
  /** Whether the bridge is enabled */
  enabled: boolean;
  /** Integration availability status */
  integrationStatus: Record<string, boolean>;
  /** Last validated timestamp */
  lastValidated?: string;
}

// ─── Validation ────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}
