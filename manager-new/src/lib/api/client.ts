/**
 * AgentForge Typed API Client (Phase 1 Foundation)
 */

export interface HealthStatus {
  status: 'ok' | 'error';
  version: string;
  bridgesCount: number;
  timestamp: string;
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

export interface CatalogSummary {
  totalItems: number;
  bridgesCount: number;
  mcpServersCount: number;
  presetsCount: number;
  capabilitiesCount: number;
  readyItemsCount: number;
  blockedItemsCount: number;
}

export interface CatalogResponse {
  summary: CatalogSummary;
  items: CatalogItem[];
}

export interface McpServerItem {
  id: string;
  name: string;
  command: string;
  args?: string[];
  status: 'running' | 'stopped' | 'failed';
  toolsCount: number;
  tools?: Array<{
    name: string;
    description: string;
  }>;
}

export interface WorkflowRunItem {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  totalSteps: number;
}

export interface DomainDetails {
  domain: string;
  domainStatus: string;
  domainPlanStatus: string;
  registeredTo: string;
  expirationDate: string;
  daysRemaining: number;
  ipAddress: string;
  ssl: string;
  registrarLock: boolean;
  privacyProtection: boolean;
  autoRenew: boolean;
  dnsRecordsCount: number;
}

export interface PredefinedWorkflow {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  steps: Array<{
    id: string;
    name: string;
    bridge: string;
    action: string;
    inputs: Record<string, unknown>;
    dependsOn?: string[];
  }>;
}

export interface WorkflowRunDetail {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  totalSteps: number;
  steps: Array<{
    id: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
    output?: unknown;
    error?: string;
  }>;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-AgentForge-Client': 'manager-new',
      ...(options?.headers || {}),
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API error ${res.status}: ${errorText || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  getStatus: () => request<HealthStatus>('/api/status'),
  getCatalog: () => request<CatalogResponse>('/api/catalog'),
  getBridges: () => request<any[]>('/api/bridges'),
  getTruthCapabilities: () => request<any[]>('/api/truth/capabilities'),
  getMcpServers: () => request<McpServerItem[]>('/api/mcp/servers'),
  getMcpPresets: () => request<any[]>('/api/catalog/presets'),
  getWorkflows: () => request<WorkflowRunItem[]>('/api/workflows/runs'),
  getPredefinedWorkflows: () => request<PredefinedWorkflow[]>('/api/workflows/predefined'),
  startWorkflowRun: (workflowId: string, inputs: Record<string, unknown> = {}) =>
    request<{ success: boolean; run: WorkflowRunDetail }>('/api/workflows/runs', {
      method: 'POST',
      body: JSON.stringify({ workflowId, inputs }),
    }),
  approveWorkflowCheckpoint: (runId: string, approvedBy = 'Local Operator', notes = 'Approved in Manager') =>
    request<{ success: boolean; run: WorkflowRunDetail }>(`/api/workflows/runs/${runId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approvedBy, notes }),
    }),
  rejectWorkflowCheckpoint: (runId: string, rejectedBy = 'Local Operator', reason = 'Rejected in Manager') =>
    request<{ success: boolean; run: WorkflowRunDetail }>(`/api/workflows/runs/${runId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ rejectedBy, reason }),
    }),
  cancelWorkflowRun: (runId: string, reason = 'Cancelled by operator') =>
    request<{ success: boolean; run: WorkflowRunDetail }>(`/api/workflows/runs/${runId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  getApprovals: () => request<any[]>('/api/approvals'),
  getDomainDetails: () => request<DomainDetails>('/api/northwest/domain'),
  sendDomainAction: (action: string, payload: Record<string, unknown> = {}) =>
    request<{ success: boolean; message?: string; result?: unknown }>('/api/northwest/action', {
      method: 'POST',
      body: JSON.stringify({ action, inputs: payload }),
    }),
};
