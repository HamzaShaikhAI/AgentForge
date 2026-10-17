import { BaseIntegrationAdapter } from './base-adapter.js';
import { BridgeRegistry } from '../bridge-registry.js';
import { McpManager } from '../mcp/mcp-manager.js';

export type AdapterHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured';

export interface AdapterHealthRecord {
  name: string;
  type: 'native' | 'mcp';
  status: AdapterHealthStatus;
  latencyMs: number;
  lastChecked: string;
  consecutiveFailures: number;
  message?: string;
  details?: Record<string, unknown>;
}

export type HealthChangeCallback = (
  name: string,
  prevStatus: AdapterHealthStatus,
  newStatus: AdapterHealthStatus,
) => void;

/**
 * Adapter Health Monitor for AgentForge.
 * Periodically polls or executes on-demand health probes across all native adapters
 * and MCP servers, tracking latency, consecutive failures, and state transitions.
 */
export class AdapterHealthMonitor {
  private adapters = new Map<string, BaseIntegrationAdapter>();
  private registry?: BridgeRegistry;
  private mcpManager?: McpManager;
  private statusMap = new Map<string, AdapterHealthRecord>();
  private listeners: HealthChangeCallback[] = [];

  constructor(options?: {
    registry?: BridgeRegistry;
    mcpManager?: McpManager;
  }) {
    this.registry = options?.registry;
    this.mcpManager = options?.mcpManager;
  }

  /**
   * Register a native adapter to be monitored.
   */
  registerAdapter(name: string, adapter: BaseIntegrationAdapter): void {
    this.adapters.set(name, adapter);
  }

  /**
   * Subscribe to health status transitions.
   */
  onStatusChange(callback: HealthChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private notify(name: string, prevStatus: AdapterHealthStatus, newStatus: AdapterHealthStatus): void {
    if (prevStatus !== newStatus) {
      for (const listener of this.listeners) {
        try {
          listener(name, prevStatus, newStatus);
        } catch {
          // Ignore subscriber errors
        }
      }
    }
  }

  /**
   * Perform a health check probe for a specific native adapter.
   */
  async checkAdapter(name: string): Promise<AdapterHealthRecord> {
    const adapter = this.adapters.get(name);
    const existing = this.statusMap.get(name);
    const prevStatus = existing?.status || 'unconfigured';
    const now = new Date().toISOString();

    if (!adapter) {
      // Check if it's an MCP server
      if (this.mcpManager) {
        const mcpServer = this.mcpManager.getServer(name);
        if (mcpServer) {
          const status: AdapterHealthStatus =
            mcpServer.status === 'connected' ? 'healthy' :
            mcpServer.status === 'connecting' ? 'degraded' :
            mcpServer.status === 'error' ? 'unhealthy' : 'unconfigured';

          const record: AdapterHealthRecord = {
            name,
            type: 'mcp',
            status,
            latencyMs: 0,
            lastChecked: now,
            consecutiveFailures: mcpServer.status === 'error' ? (existing?.consecutiveFailures ?? 0) + 1 : 0,
            message: mcpServer.error || `MCP status: ${mcpServer.status}`,
          };
          this.statusMap.set(name, record);
          this.notify(name, prevStatus, status);
          return record;
        }
      }

      const record: AdapterHealthRecord = {
        name,
        type: 'native',
        status: 'unconfigured',
        latencyMs: 0,
        lastChecked: now,
        consecutiveFailures: 0,
        message: `Adapter "${name}" is not registered`,
      };
      this.statusMap.set(name, record);
      return record;
    }

    const startTime = performance.now();
    try {
      const probeRes = await adapter.checkHealth();
      const latencyMs = Math.round(performance.now() - startTime);

      const status: AdapterHealthStatus =
        probeRes.healthy ? 'healthy' :
        probeRes.status === 'unconfigured' ? 'unconfigured' : 'unhealthy';

      const consecutiveFailures = status === 'unhealthy' ? (existing?.consecutiveFailures ?? 0) + 1 : 0;

      const record: AdapterHealthRecord = {
        name,
        type: 'native',
        status,
        latencyMs,
        lastChecked: now,
        consecutiveFailures,
        message: probeRes.message,
        details: probeRes.details,
      };

      this.statusMap.set(name, record);
      this.notify(name, prevStatus, status);
      return record;
    } catch (err) {
      const latencyMs = Math.round(performance.now() - startTime);
      const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
      const status: AdapterHealthStatus = 'unhealthy';

      const record: AdapterHealthRecord = {
        name,
        type: 'native',
        status,
        latencyMs,
        lastChecked: now,
        consecutiveFailures,
        message: (err as Error).message,
      };

      this.statusMap.set(name, record);
      this.notify(name, prevStatus, status);
      return record;
    }
  }

  /**
   * Run health checks for all registered adapters and connected MCP servers.
   */
  async checkAll(): Promise<Map<string, AdapterHealthRecord>> {
    const promises: Promise<AdapterHealthRecord>[] = [];

    for (const name of this.adapters.keys()) {
      promises.push(this.checkAdapter(name));
    }

    if (this.mcpManager) {
      for (const server of this.mcpManager.listServers()) {
        if (!this.adapters.has(server.id)) {
          promises.push(this.checkAdapter(server.id));
        }
      }
    }

    await Promise.all(promises);
    return new Map(this.statusMap);
  }

  /**
   * Get cached status record for an adapter.
   */
  getStatus(name: string): AdapterHealthRecord | undefined {
    return this.statusMap.get(name);
  }

  /**
   * Get all cached health status records.
   */
  getAllStatus(): AdapterHealthRecord[] {
    return Array.from(this.statusMap.values());
  }
}
