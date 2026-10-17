import { BaseIntegrationAdapter, AdapterHealthResult, AdapterActionDefinition } from './base-adapter.js';

export class BraveSearchAdapter extends BaseIntegrationAdapter {
  readonly name = 'brave-search';
  readonly displayName = 'Brave Search';
  readonly description = 'Privacy-preserving web search and local business queries.';
  readonly version = '1.0.0';
  readonly category = 'productivity';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'web-search', description: 'Search web indexed pages', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'local-search', description: 'Search local businesses and locations', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasKey = Boolean(process.env.BRAVE_API_KEY);
    return {
      healthy: hasKey,
      status: hasKey ? 'configured' : 'unconfigured',
      message: hasKey ? 'BRAVE_API_KEY present' : 'BRAVE_API_KEY required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    const query = inputs.query as string;
    if (!query) throw new Error(`${action} requires "query" parameter`);
    return { query, results: [], total: 0 };
  }
}

export class TavilyAdapter extends BaseIntegrationAdapter {
  readonly name = 'tavily';
  readonly displayName = 'Tavily Research';
  readonly description = 'AI-optimized factual research search with citations.';
  readonly version = '1.0.0';
  readonly category = 'productivity';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'search', description: 'Execute factual research query returning summaries and sources', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'extract', description: 'Extract clean markdown content from specific web URLs', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasKey = Boolean(process.env.TAVILY_API_KEY);
    return {
      healthy: hasKey,
      status: hasKey ? 'configured' : 'unconfigured',
      message: hasKey ? 'TAVILY_API_KEY present' : 'TAVILY_API_KEY required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'search') {
      const query = inputs.query as string;
      if (!query) throw new Error('search requires "query" parameter');
      return { query, answer: `Factual summary for "${query}"`, results: [] };
    }
    if (action === 'extract') {
      const urls = inputs.urls as string[];
      if (!urls || !Array.isArray(urls)) throw new Error('extract requires "urls" array');
      return { extracted: urls.map(u => ({ url: u, content: `Extracted content from ${u}` })) };
    }
    throw new Error(`Unsupported action "${action}" on TavilyAdapter`);
  }
}

export class MemoryAdapter extends BaseIntegrationAdapter {
  readonly name = 'memory';
  readonly displayName = 'Knowledge Graph Memory';
  readonly description = 'Local graph memory store for persistent entities, attributes, and relationships.';
  readonly version = '1.0.0';
  readonly category = 'productivity';

  private entities = new Map<string, Record<string, unknown>>();

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'add-entity', description: 'Create or update an entity in knowledge graph', permissionLevel: 'local-write', sideEffects: true, requiresApproval: false },
      { action: 'query-graph', description: 'Retrieve all knowledge graph entities and relations', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'search-nodes', description: 'Search graph entities matching query', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    return {
      healthy: true,
      status: 'available',
      message: 'Knowledge graph memory adapter active and ready',
      details: { entityCount: this.entities.size },
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'add-entity') {
      const name = inputs.name as string;
      if (!name) throw new Error('add-entity requires "name" parameter');
      this.entities.set(name, inputs);
      return { name, stored: true, totalEntities: this.entities.size };
    }
    if (action === 'query-graph') {
      return { entities: Array.from(this.entities.values()), count: this.entities.size };
    }
    if (action === 'search-nodes') {
      const q = ((inputs.query as string) || '').toLowerCase();
      const matched = Array.from(this.entities.entries())
        .filter(([k]) => k.toLowerCase().includes(q))
        .map(([, v]) => v);
      return { query: q, matches: matched, count: matched.length };
    }
    throw new Error(`Unsupported action "${action}" on MemoryAdapter`);
  }
}

export class StripeAdapter extends BaseIntegrationAdapter {
  readonly name = 'stripe';
  readonly displayName = 'Stripe Payments';
  readonly description = 'Stripe billing, customer query, and invoice management.';
  readonly version = '1.0.0';
  readonly category = 'cloud-services';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'get-customer', description: 'Retrieve customer account details by ID', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'list-invoices', description: 'List recent customer invoices and statuses', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'get-balance', description: 'Inspect available account balance and currency', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasKey = Boolean(process.env.STRIPE_SECRET_KEY);
    return {
      healthy: hasKey,
      status: hasKey ? 'configured' : 'unconfigured',
      message: hasKey ? 'STRIPE_SECRET_KEY present' : 'STRIPE_SECRET_KEY required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'get-customer') {
      const customerId = inputs.customerId as string;
      if (!customerId) throw new Error('get-customer requires "customerId"');
      return { id: customerId, email: 'customer@example.com', currency: 'usd' };
    }
    if (action === 'list-invoices') return { invoices: [], count: 0 };
    if (action === 'get-balance') return { available: [{ amount: 0, currency: 'usd' }] };
    throw new Error(`Unsupported action "${action}" on StripeAdapter`);
  }
}
