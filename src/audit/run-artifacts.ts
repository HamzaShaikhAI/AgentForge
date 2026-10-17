import { randomBytes } from 'node:crypto';

export interface RunArtifact {
  artifactId: string;
  runId: string;
  stepId?: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  content?: string;
  path?: string;
}

export interface CreateArtifactOptions {
  runId: string;
  stepId?: string;
  name: string;
  mimeType?: string;
  content?: string;
  path?: string;
  sizeBytes?: number;
}

export interface RunLogEntry {
  logId: string;
  runId: string;
  stepId?: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

export interface CreateLogOptions {
  runId: string;
  stepId?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

export type LogStreamListener = (entry: RunLogEntry) => void;

/**
 * Run Artifacts & Log Streaming Service for AgentForge.
 * Captures execution telemetry, intermediate files, structured artifacts,
 * and enables real-time log event streaming for the Manager UI and Antigravity.
 */
export class RunArtifactsService {
  private artifacts = new Map<string, RunArtifact>();
  private logs: RunLogEntry[] = [];
  private listeners = new Map<string, LogStreamListener[]>();

  /**
   * Attach an output artifact to a workflow run.
   */
  addArtifact(options: CreateArtifactOptions): RunArtifact {
    const artifactId = `art_${Date.now()}_${randomBytes(8).toString('hex')}`;
    const sizeBytes = options.sizeBytes ?? (options.content ? Buffer.byteLength(options.content, 'utf-8') : 0);

    const artifact: RunArtifact = {
      artifactId,
      runId: options.runId,
      stepId: options.stepId,
      name: options.name,
      mimeType: options.mimeType || 'application/octet-stream',
      sizeBytes,
      createdAt: new Date().toISOString(),
      content: options.content,
      path: options.path,
    };

    this.artifacts.set(artifactId, artifact);
    return artifact;
  }

  /**
   * Retrieve a specific artifact by its artifactId.
   */
  getArtifact(artifactId: string): RunArtifact | undefined {
    return this.artifacts.get(artifactId);
  }

  /**
   * Get all artifacts associated with a workflow run.
   */
  getRunArtifacts(runId: string): RunArtifact[] {
    return Array.from(this.artifacts.values()).filter(a => a.runId === runId);
  }

  /**
   * Append a structured log entry for a workflow run and broadcast to active stream listeners.
   */
  appendLog(options: CreateLogOptions): RunLogEntry {
    const logId = `log_${Date.now()}_${randomBytes(6).toString('hex')}`;
    const entry: RunLogEntry = {
      logId,
      runId: options.runId,
      stepId: options.stepId,
      timestamp: new Date().toISOString(),
      level: options.level || 'info',
      message: options.message,
      details: options.details,
    };

    this.logs.push(entry);

    // Notify listeners for this runId
    const runListeners = this.listeners.get(options.runId);
    if (runListeners) {
      for (const listener of runListeners) {
        try {
          listener(entry);
        } catch {
          // ignore stream listener error
        }
      }
    }

    return entry;
  }

  /**
   * Retrieve all log entries for a given run with optional filtering.
   */
  getRunLogs(
    runId: string,
    filter?: { stepId?: string; level?: 'debug' | 'info' | 'warn' | 'error' },
  ): RunLogEntry[] {
    return this.logs.filter(l => {
      if (l.runId !== runId) return false;
      if (filter?.stepId && l.stepId !== filter.stepId) return false;
      if (filter?.level && l.level !== filter.level) return false;
      return true;
    });
  }

  /**
   * Subscribe to live real-time logs for a specific runId.
   */
  subscribeRunLogs(runId: string, listener: LogStreamListener): () => void {
    const current = this.listeners.get(runId) || [];
    current.push(listener);
    this.listeners.set(runId, current);

    return () => {
      const active = this.listeners.get(runId);
      if (active) {
        this.listeners.set(runId, active.filter(l => l !== listener));
      }
    };
  }
}
