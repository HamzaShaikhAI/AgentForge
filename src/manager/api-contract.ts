/**
 * AgentForge Manager API Contract & Type Definitions (Phase 1 Modernization)
 * Provides type-safe interfaces for frontend API consumers, OpenAPI schema generator,
 * and TanStack Query / React hooks.
 */

export interface HealthStatusResponse {
  status: 'ok' | 'error';
  version: string;
  bridgesCount: number;
  timestamp: string;
}

export interface BridgeCapabilityDefinition {
  action: string;
  description: string;
  permissionLevel: 'read' | 'local-write' | 'external-write' | 'publish' | 'destructive';
  sideEffects: boolean;
  requiresApproval?: boolean;
}

export interface BridgeItem {
  manifest: {
    schema: string;
    name: string;
    displayName: string;
    description: string;
    version: string;
    capabilities: BridgeCapabilityDefinition[];
    integrations?: string[];
    auth?: string[];
  };
  isValid: boolean;
  errors?: string[];
}

export interface CatalogSummary {
  totalItems: number;
  bridgesCount: number;
  mcpServersCount: number;
  presetsCount: number;
  capabilitiesCount: number;
  readyItemsCount: number;
  blockedItemsCount: number;
}

export interface CatalogItem {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  kind: 'bridge' | 'mcp-server' | 'mcp-preset';
  status: 'active' | 'configured' | 'available' | 'blocked';
  capabilitiesCount: number;
  capabilities: Array<{
    action: string;
    description: string;
    permissionLevel: string;
    sideEffects: boolean;
  }>;
}

export interface CatalogResponse {
  summary: CatalogSummary;
  items: CatalogItem[];
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  status: 'running' | 'stopped' | 'failed';
  toolsCount: number;
  tools?: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

export interface McpPresetItem {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  command: string;
  args: string[];
  toolsCount: number;
  declaredTools: string[];
  installed: boolean;
}

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  totalSteps: number;
  stepName?: string;
  error?: string;
  needsReconciliation?: boolean;
}

export interface ApprovalQueueItem {
  id: string;
  runId: string;
  workflowName: string;
  stepId: string;
  stepName: string;
  bridge: string;
  action: string;
  permissionLevel: 'publish' | 'external-write' | 'destructive';
  inputs: Record<string, unknown>;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface NorthwestDomainDetails {
  domain: string;
  domainStatus: string;
  domainPlanStatus: string;
  registeredTo: string;
  registeredOn: string;
  expirationDate: string;
  daysRemaining: number;
  ipAddress: string;
  ssl: string;
  registrarLock: boolean;
  privacyProtection: boolean;
  autoRenew: boolean;
  domainParking: boolean;
  dnsRecordsCount: number;
  nameservers: string[];
  emailForwardersCount: number;
  websiteHostingLinked: boolean;
  activeProvider?: string;
  liveUrl?: string;
}

export interface NorthwestActionResponse {
  success: boolean;
  message: string;
  action: string;
  domain: string;
  domainDetails?: NorthwestDomainDetails;
  records?: Array<{
    id: string;
    domain: string;
    type: string;
    name: string;
    value: string;
    ttl: number;
  }>;
}

export interface TruthCapabilityRow {
  bridge: string;
  action: string;
  description: string;
  permissionLevel: string;
  sideEffects: boolean;
  requiresApproval: boolean;
  executable: boolean;
  reason?: string;
}

export interface StagedBridgeDraft {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  status: 'draft' | 'analyzing' | 'generated' | 'testing' | 'awaiting-review' | 'approved' | 'registered';
  testResults?: {
    passed: boolean;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    output?: string;
  };
}
