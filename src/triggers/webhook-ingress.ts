import { createHmac, timingSafeEqual } from 'node:crypto';
import { WorkflowEngine } from '../workflow-engine.js';
import { WorkflowRun } from '../types.js';

export interface WebhookEndpointConfig {
  endpointId: string;
  path: string;
  secret: string;
  headerName?: string;
  workflowId: string;
  eventFilter?: string[];
  inputMapping?: Record<string, string>;
}

export interface WebhookHandlingResult {
  success: boolean;
  statusCode: number;
  message: string;
  run?: WorkflowRun;
}

/**
 * Webhook Ingress Trigger system for AgentForge.
 * Validates HMAC SHA-256 signatures with timing-safe comparisons,
 * routes payloads, and triggers corresponding workflows.
 */
export class WebhookIngress {
  private endpoints = new Map<string, WebhookEndpointConfig>();
  private engine?: WorkflowEngine;

  constructor(engine?: WorkflowEngine) {
    this.engine = engine;
  }

  setEngine(engine: WorkflowEngine): void {
    this.engine = engine;
  }

  /**
   * Register a new webhook endpoint.
   */
  registerEndpoint(config: WebhookEndpointConfig): void {
    const normalizedPath = config.path.startsWith('/') ? config.path : `/${config.path}`;
    this.endpoints.set(normalizedPath, {
      ...config,
      path: normalizedPath,
      headerName: (config.headerName || 'x-hub-signature-256').toLowerCase(),
    });
  }

  /**
   * Unregister a webhook endpoint.
   */
  unregisterEndpoint(path: string): boolean {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return this.endpoints.delete(normalizedPath);
  }

  /**
   * Verify an HMAC-SHA256 signature against the raw body using timing-safe comparison.
   */
  verifySignature(rawBody: string | Buffer, secret: string, providedSignature: string): boolean {
    if (!providedSignature || !secret) {
      return false;
    }

    // Strip prefix if present (e.g., "sha256=")
    let cleanSignature = providedSignature.trim();
    if (cleanSignature.startsWith('sha256=')) {
      cleanSignature = cleanSignature.slice(7);
    }

    const hmac = createHmac('sha256', secret);
    hmac.update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf-8') : rawBody);
    const expectedSignature = hmac.digest('hex');

    if (cleanSignature.length !== expectedSignature.length) {
      return false;
    }

    const cleanBuf = Buffer.from(cleanSignature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');

    if (cleanBuf.length !== expectedBuf.length) {
      return false;
    }

    return timingSafeEqual(cleanBuf, expectedBuf);
  }

  /**
   * Process an incoming HTTP webhook request.
   */
  async handleWebhook(
    path: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
  ): Promise<WebhookHandlingResult> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const endpoint = this.endpoints.get(normalizedPath);

    if (!endpoint) {
      return {
        success: false,
        statusCode: 404,
        message: `No webhook endpoint registered for path "${normalizedPath}"`,
      };
    }

    // Find signature header (case-insensitive)
    const headerKey = endpoint.headerName || 'x-hub-signature-256';
    let providedSig: string | undefined;
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === headerKey) {
        providedSig = Array.isArray(v) ? v[0] : v;
        break;
      }
    }

    if (!providedSig) {
      return {
        success: false,
        statusCode: 401,
        message: `Missing signature header "${headerKey}"`,
      };
    }

    const isValid = this.verifySignature(rawBody, endpoint.secret, providedSig);
    if (!isValid) {
      return {
        success: false,
        statusCode: 403,
        message: 'Invalid HMAC signature',
      };
    }

    // Parse body
    let payload: Record<string, unknown> = {};
    try {
      const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
      payload = JSON.parse(bodyStr);
    } catch {
      return {
        success: false,
        statusCode: 400,
        message: 'Invalid JSON payload',
      };
    }

    // Event filtering if configured
    if (endpoint.eventFilter && endpoint.eventFilter.length > 0) {
      const eventType = String(payload.event || payload.action || payload.type || '');
      if (!endpoint.eventFilter.includes(eventType)) {
        return {
          success: true,
          statusCode: 200,
          message: `Event "${eventType}" ignored by filter`,
        };
      }
    }

    // Map inputs if configured
    const initialInputs: Record<string, unknown> = {
      webhookPayload: payload,
    };

    if (endpoint.inputMapping) {
      for (const [targetKey, sourcePath] of Object.entries(endpoint.inputMapping)) {
        let val: any = payload;
        for (const part of sourcePath.split('.')) {
          if (val && typeof val === 'object' && part in val) {
            val = val[part];
          } else {
            val = undefined;
            break;
          }
        }
        if (val !== undefined) {
          initialInputs[targetKey] = val;
        }
      }
    }

    // Trigger workflow if engine is available
    if (this.engine) {
      try {
        const run = await this.engine.startRun(endpoint.workflowId, initialInputs);
        return {
          success: true,
          statusCode: 202,
          message: `Webhook accepted, workflow run "${run.runId}" triggered`,
          run,
        };
      } catch (err) {
        return {
          success: false,
          statusCode: 500,
          message: `Failed to trigger workflow: ${(err as Error).message}`,
        };
      }
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Webhook validated successfully (no engine configured to run workflow)',
    };
  }

  /**
   * Get all registered webhook endpoints (with secrets masked).
   */
  getEndpoints(): Array<Omit<WebhookEndpointConfig, 'secret'> & { secretConfigured: boolean }> {
    return Array.from(this.endpoints.values()).map(e => ({
      endpointId: e.endpointId,
      path: e.path,
      headerName: e.headerName,
      workflowId: e.workflowId,
      eventFilter: e.eventFilter,
      inputMapping: e.inputMapping,
      secretConfigured: Boolean(e.secret && e.secret.length > 0),
    }));
  }
}
