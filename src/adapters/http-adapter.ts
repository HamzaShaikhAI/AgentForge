import { BaseIntegrationAdapter, AdapterHealthResult, AdapterActionDefinition } from './base-adapter.js';

export class HttpAdapter extends BaseIntegrationAdapter {
  readonly name = 'http';
  readonly displayName = 'HTTP & REST Client';
  readonly description = 'Outbound HTTP/HTTPS client for REST endpoints with SSRF loopback protections.';
  readonly version = '1.0.0';
  readonly category = 'api';

  private allowLoopback: boolean;

  constructor(options?: { allowLoopback?: boolean }) {
    super();
    this.allowLoopback = options?.allowLoopback ?? false;
  }

  getActions(): AdapterActionDefinition[] {
    return [
      {
        action: 'get',
        description: 'Send HTTP GET request to a URL and parse JSON or text response',
        permissionLevel: 'read',
        sideEffects: false,
        requiresApproval: false,
      },
      {
        action: 'post',
        description: 'Send HTTP POST request with body payload',
        permissionLevel: 'external-write',
        sideEffects: true,
        requiresApproval: true,
      },
      {
        action: 'put',
        description: 'Send HTTP PUT request with payload',
        permissionLevel: 'external-write',
        sideEffects: true,
        requiresApproval: true,
      },
      {
        action: 'delete',
        description: 'Send HTTP DELETE request',
        permissionLevel: 'destructive',
        sideEffects: true,
        requiresApproval: true,
      },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    return {
      healthy: true,
      status: 'available',
      message: 'HTTP client active and ready',
      details: { allowLoopback: this.allowLoopback },
    };
  }

  private validateUrl(rawUrl: string): URL {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('URL must be a non-empty string');
    }
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Protocol "${parsed.protocol}" not supported. Use http or https.`);
    }

    if (!this.allowLoopback) {
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.endsWith('.local')
      ) {
        throw new Error(`SSRF Protection: Outbound requests to private/loopback network address "${hostname}" are blocked`);
      }
    }
    return parsed;
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    const rawUrl = inputs.url as string;
    const url = this.validateUrl(rawUrl);
    const headers = (inputs.headers as Record<string, string>) || {};
    const body = inputs.body;
    const method = action.toUpperCase();

    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      throw new Error(`Unsupported HTTP action "${action}"`);
    }

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'User-Agent': 'AgentForge-V1-Harness/1.0',
        ...headers,
      },
    };

    if (body !== undefined && method !== 'GET') {
      if (typeof body === 'object') {
        fetchOptions.body = JSON.stringify(body);
        if (!fetchOptions.headers || !('Content-Type' in fetchOptions.headers)) {
          (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
        }
      } else {
        fetchOptions.body = String(body);
      }
    }

    const response = await fetch(url.toString(), fetchOptions);
    const contentType = response.headers.get('content-type') || '';
    let responseData: unknown;

    if (contentType.includes('application/json')) {
      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }
    } else {
      responseData = await response.text();
    }

    return {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      data: responseData,
    };
  }
}
