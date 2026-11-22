import { QueryKey } from '@tanstack/react-query';

export const queryKeys = {
  // Dashboard
  dashboard: () => ['dashboard'] as QueryKey,
  healthScore: () => ['health-score'] as QueryKey,
  smartFeed: () => ['smart-feed'] as QueryKey,
  quickStart: () => ['quick-start'] as QueryKey,

  // Catalog
  catalog: (filters?: Record<string, unknown>) => ['catalog', filters] as QueryKey,
  bridges: () => ['bridges'] as QueryKey,
  catalogItem: (id: string) => ['catalog', 'item', id] as QueryKey,
  truthMatrix: (filters?: Record<string, unknown>) => ['truth-matrix', filters] as QueryKey,
  presets: (filters?: Record<string, unknown>) => ['presets', filters] as QueryKey,
  preset: (id: string) => ['presets', id] as QueryKey,

  // Integrations - MCP
  mcpServers: (filters?: Record<string, unknown>) => ['mcp', 'servers', filters] as QueryKey,
  mcpServer: (id: string) => ['mcp', 'servers', id] as QueryKey,
  mcpTopology: () => ['mcp', 'topology'] as QueryKey,
  mcpRadar: () => ['mcp', 'radar'] as QueryKey,
  mcpMarketplace: (filters?: Record<string, unknown>) => ['mcp', 'marketplace', filters] as QueryKey,

  // Integrations - Domains
  domain: (domain: string) => ['domain', domain] as QueryKey,
  domainDns: (domain: string) => ['domain', domain, 'dns'] as QueryKey,

  // Integrations - Auth
  authStatus: (provider: string) => ['auth', provider, 'status'] as QueryKey,

  // Workflows
  workflows: (filters?: Record<string, unknown>) => ['workflows', filters] as QueryKey,
  workflow: (id: string) => ['workflows', id] as QueryKey,
  workflowRuns: (filters?: Record<string, unknown>) => ['workflows', 'runs', filters] as QueryKey,
  workflowRun: (id: string) => ['workflows', 'runs', id] as QueryKey,
  workflowTimeline: (runId: string) => ['workflows', 'runs', runId, 'timeline'] as QueryKey,
  approvals: (filters?: Record<string, unknown>) => ['workflows', 'approvals', filters] as QueryKey,
  approval: (runId: string) => ['workflows', 'approvals', runId] as QueryKey,
  reconciliation: (filters?: Record<string, unknown>) => ['workflows', 'reconciliation', filters] as QueryKey,
  reconciliationRun: (runId: string) => ['workflows', 'reconciliation', runId] as QueryKey,

  // Security
  vaultStatus: () => ['security', 'vault'] as QueryKey,
  credentialHealth: (provider: string) => ['security', 'credential', provider] as QueryKey,
  auditLog: (filters?: Record<string, unknown>) => ['security', 'audit', filters] as QueryKey,

  // Settings
  settings: () => ['settings'] as QueryKey,
  diagnostics: () => ['settings', 'diagnostics'] as QueryKey,
  stagedBridges: () => ['settings', 'builder', 'staged'] as QueryKey,
} as const;

export const mutationKeys = {
  // MCP
  addMcpServer: () => ['mcp', 'servers', 'add'] as QueryKey,
  connectMcpServer: (id: string) => ['mcp', 'servers', id, 'connect'] as QueryKey,
  disconnectMcpServer: (id: string) => ['mcp', 'servers', id, 'disconnect'] as QueryKey,
  testMcpServer: (id: string) => ['mcp', 'servers', id, 'test'] as QueryKey,
  removeMcpServer: (id: string) => ['mcp', 'servers', id, 'remove'] as QueryKey,
  installPreset: (id: string) => ['mcp', 'presets', id, 'install'] as QueryKey,

  // Domains
  domainAction: (domain: string, action: string) => ['domain', domain, action] as QueryKey,

  // Workflows
  runWorkflow: (id: string) => ['workflows', id, 'run'] as QueryKey,
  cancelRun: (runId: string) => ['workflows', 'runs', runId, 'cancel'] as QueryKey,
  approveCheckpoint: (runId: string) => ['workflows', 'approvals', runId, 'approve'] as QueryKey,
  rejectCheckpoint: (runId: string) => ['workflows', 'approvals', runId, 'reject'] as QueryKey,
  reconcileRun: (runId: string) => ['workflows', 'reconciliation', runId, 'reconcile'] as QueryKey,

  // Auth
  connectAuth: (provider: string) => ['auth', provider, 'connect'] as QueryKey,
  disconnectAuth: (provider: string) => ['auth', provider, 'disconnect'] as QueryKey,
  configureAuth: (provider: string) => ['auth', provider, 'configure'] as QueryKey,

  // Builder
  analyzeBuilder: () => ['builder', 'analyze'] as QueryKey,
  generateBridge: () => ['builder', 'generate'] as QueryKey,
  testStagedBridge: (id: string) => ['builder', 'staged', id, 'test'] as QueryKey,
  validateStagedBridge: (id: string) => ['builder', 'staged', id, 'validate'] as QueryKey,
  registerBridge: (id: string) => ['builder', 'staged', id, 'register'] as QueryKey,
} as const;

async function requestFn<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `/api${endpoint.startsWith('/api') ? endpoint.slice(4) : endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `API error: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  baseUrl: '/api',

  request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return requestFn<T>(endpoint, options);
  },

  get<T>(endpoint: string, options?: any): Promise<T> {
    return requestFn<T>(endpoint, { method: 'GET', ...options });
  },

  post<T>(endpoint: string, data?: unknown): Promise<T> {
    return requestFn<T>(endpoint, {
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  },

  put<T>(endpoint: string, data?: unknown): Promise<T> {
    return requestFn<T>(endpoint, {
      method: 'PUT',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  },

  patch<T>(endpoint: string, data?: unknown): Promise<T> {
    return requestFn<T>(endpoint, {
      method: 'PATCH',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  },

  delete<T>(endpoint: string): Promise<T> {
    return requestFn<T>(endpoint, { method: 'DELETE' });
  },
};