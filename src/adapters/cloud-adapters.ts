import { BaseIntegrationAdapter, AdapterHealthResult, AdapterActionDefinition } from './base-adapter.js';

export class AwsS3Adapter extends BaseIntegrationAdapter {
  readonly name = 'aws-s3';
  readonly displayName = 'AWS S3 Storage';
  readonly description = 'Amazon Simple Storage Service (S3) bucket and object management.';
  readonly version = '1.0.0';
  readonly category = 'cloud-services';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'list-buckets', description: 'List accessible S3 storage buckets', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'list-objects', description: 'List object keys inside an S3 bucket', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'get-object-meta', description: 'Retrieve S3 object metadata and content length', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasKeys = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    return {
      healthy: hasKeys,
      status: hasKeys ? 'configured' : 'unconfigured',
      message: hasKeys ? 'AWS S3 credentials present in environment' : 'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'list-buckets') return { buckets: [], count: 0 };
    if (action === 'list-objects') {
      const bucket = inputs.bucket as string;
      if (!bucket) throw new Error('list-objects requires "bucket" parameter');
      return { bucket, objects: [], count: 0 };
    }
    if (action === 'get-object-meta') {
      const bucket = inputs.bucket as string;
      const key = inputs.key as string;
      if (!bucket || !key) throw new Error('get-object-meta requires "bucket" and "key" parameters');
      return { bucket, key, contentLength: 1024, contentType: 'application/octet-stream' };
    }
    throw new Error(`Unsupported action "${action}" on AwsS3Adapter`);
  }
}

export class CloudflareAdapter extends BaseIntegrationAdapter {
  readonly name = 'cloudflare';
  readonly displayName = 'Cloudflare';
  readonly description = 'DNS records and Cloudflare Workers management.';
  readonly version = '1.0.0';
  readonly category = 'cloud-services';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'list-zones', description: 'List domains managed in Cloudflare account', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'get-dns-records', description: 'List DNS records for a domain zone', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'list-workers', description: 'List deployed Cloudflare Workers', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasToken = Boolean(process.env.CLOUDFLARE_API_TOKEN);
    return {
      healthy: hasToken,
      status: hasToken ? 'configured' : 'unconfigured',
      message: hasToken ? 'CLOUDFLARE_API_TOKEN configured' : 'CLOUDFLARE_API_TOKEN required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'list-zones') return { zones: [], count: 0 };
    if (action === 'get-dns-records') {
      const zoneId = inputs.zoneId as string;
      if (!zoneId) throw new Error('get-dns-records requires "zoneId" parameter');
      return { zoneId, records: [] };
    }
    if (action === 'list-workers') return { workers: [], count: 0 };
    throw new Error(`Unsupported action "${action}" on CloudflareAdapter`);
  }
}

export class PostgresAdapter extends BaseIntegrationAdapter {
  readonly name = 'postgres';
  readonly displayName = 'PostgreSQL';
  readonly description = 'Relational PostgreSQL database client.';
  readonly version = '1.0.0';
  readonly category = 'cloud-services';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'execute-query', description: 'Execute read query on PostgreSQL database', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'list-tables', description: 'List schema tables in current database', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasConn = Boolean(process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL);
    return {
      healthy: hasConn,
      status: hasConn ? 'configured' : 'unconfigured',
      message: hasConn ? 'Postgres connection string present' : 'POSTGRES_CONNECTION_STRING required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'execute-query') {
      const sql = inputs.sql as string;
      if (!sql) throw new Error('execute-query requires "sql" parameter');
      return { query: sql, rows: [], rowCount: 0 };
    }
    if (action === 'list-tables') {
      return { tables: [], count: 0 };
    }
    throw new Error(`Unsupported action "${action}" on PostgresAdapter`);
  }
}

export class RedisAdapter extends BaseIntegrationAdapter {
  readonly name = 'redis';
  readonly displayName = 'Redis Cache';
  readonly description = 'In-memory Redis datastore client for keys and TTL queries.';
  readonly version = '1.0.0';
  readonly category = 'cloud-services';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'get-key', description: 'Retrieve value of a Redis key', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'set-key', description: 'Set string value with optional TTL', permissionLevel: 'local-write', sideEffects: true, requiresApproval: false },
      { action: 'delete-key', description: 'Delete key from Redis', permissionLevel: 'destructive', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasUrl = Boolean(process.env.REDIS_URL);
    return {
      healthy: hasUrl,
      status: hasUrl ? 'configured' : 'unconfigured',
      message: hasUrl ? 'REDIS_URL configured' : 'REDIS_URL required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    const key = inputs.key as string;
    if (!key) throw new Error(`${action} requires "key" parameter`);

    if (action === 'get-key') return { key, value: null, exists: false };
    if (action === 'set-key') return { key, value: inputs.value, set: true };
    if (action === 'delete-key') return { key, deleted: true };
    throw new Error(`Unsupported action "${action}" on RedisAdapter`);
  }
}

export class MongoDbAdapter extends BaseIntegrationAdapter {
  readonly name = 'mongodb';
  readonly displayName = 'MongoDB';
  readonly description = 'NoSQL document database client.';
  readonly version = '1.0.0';
  readonly category = 'cloud-services';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'find-documents', description: 'Query documents in a collection', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'count-documents', description: 'Count documents matching filter', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'insert-document', description: 'Insert document into collection', permissionLevel: 'local-write', sideEffects: true, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasUri = Boolean(process.env.MONGODB_URI);
    return {
      healthy: hasUri,
      status: hasUri ? 'configured' : 'unconfigured',
      message: hasUri ? 'MONGODB_URI configured' : 'MONGODB_URI required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    const collection = inputs.collection as string;
    if (!collection) throw new Error(`${action} requires "collection" parameter`);

    if (action === 'find-documents') return { collection, documents: [], count: 0 };
    if (action === 'count-documents') return { collection, count: 0 };
    if (action === 'insert-document') {
      const doc = inputs.document;
      if (!doc) throw new Error('insert-document requires "document" parameter');
      return { collection, insertedId: 'mock_doc_id_123', acknowledged: true };
    }
    throw new Error(`Unsupported action "${action}" on MongoDbAdapter`);
  }
}
