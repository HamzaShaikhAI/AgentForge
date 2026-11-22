import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CloudflareAdapter } from './cloudflare.js';
import { BridgeValidator } from '../bridge-validator.js';

describe('CloudflareAdapter & Bridge Manifest (Omni-Control Capabilities)', () => {
  let adapter: CloudflareAdapter;

  beforeEach(() => {
    adapter = new CloudflareAdapter();
  });

  describe('Manifest Schema Validation', () => {
    it('validates bridges/cloudflare/bridge.json with 0 errors across all 49 capabilities', () => {
      const manifestPath = resolve(process.cwd(), 'bridges', 'cloudflare', 'bridge.json');
      const raw = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);

      const validator = new BridgeValidator();
      const result = validator.validate(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(manifest.name).toBe('cloudflare');
      expect(manifest.capabilities.length).toBe(49);
    });
  });

  describe('Adapter Metadata & Actions', () => {
    it('exposes correct metadata', () => {
      expect(adapter.name).toBe('cloudflare');
      expect(adapter.displayName).toBe('Cloudflare');
      expect(adapter.category).toBe('cloud-services');
      expect(adapter.version).toBe('1.0.0');
    });

    it('declares 49 supported actions matching the manifest', () => {
      const actions = adapter.getActions();
      expect(actions).toHaveLength(49);

      const actionNames = actions.map((a) => a.action);
      expect(actionNames).toContain('list-zones');
      expect(actionNames).toContain('create-dns-record');
      expect(actionNames).toContain('delete-dns-record');
      expect(actionNames).toContain('upload-worker');
      expect(actionNames).toContain('purge-cache');
      expect(actionNames).toContain('cloudflare-raw-api');
    });

    it('enforces requiresApproval on sensitive operations', () => {
      const actions = adapter.getActions();
      const deleteZone = actions.find((a) => a.action === 'delete-zone');
      expect(deleteZone?.requiresApproval).toBe(true);
      expect(deleteZone?.permissionLevel).toBe('destructive');

      const deleteRecord = actions.find((a) => a.action === 'delete-dns-record');
      expect(deleteRecord?.requiresApproval).toBe(true);

      const uploadWorker = actions.find((a) => a.action === 'upload-worker');
      expect(uploadWorker?.requiresApproval).toBe(true);
      expect(uploadWorker?.permissionLevel).toBe('publish');
    });
  });

  describe('Health Checking', () => {
    it('reports healthy configured status in local developer mode', async () => {
      const health = await adapter.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.status).toBe('configured');
      expect(health.message).toContain('simulation enabled');
    });
  });

  describe('Domain Zones & DNS Records Execution', () => {
    it('lists active domain zones', async () => {
      const res = (await adapter.execute('list-zones')) as any;
      expect(res.success).toBe(true);
      expect(res.count).toBeGreaterThanOrEqual(1);
      expect(res.zones[0].name).toBe('hamzashaikhai.com');
    });

    it('retrieves detailed zone metadata and settings', async () => {
      const res = (await adapter.execute('get-zone-details', { zoneId: 'cf_zone_hamzashaikhai' })) as any;
      expect(res.success).toBe(true);
      expect(res.zone.id).toBe('cf_zone_hamzashaikhai');

      const settings = (await adapter.execute('get-zone-settings', { zoneId: 'cf_zone_hamzashaikhai' })) as any;
      expect(settings.success).toBe(true);
      expect(settings.settings.ssl.value).toBe('strict');
      expect(settings.settings.always_use_https.value).toBe('on');
    });

    it('creates, reads, updates, and deletes DNS records', async () => {
      // 1. Create
      const created = (await adapter.execute('create-dns-record', {
        zoneId: 'cf_zone_hamzashaikhai',
        name: 'api.hamzashaikhai.com',
        type: 'A',
        content: '1.2.3.4',
        proxied: true,
      })) as any;
      expect(created.success).toBe(true);
      expect(created.record.name).toBe('api.hamzashaikhai.com');
      const recId = created.record.id;

      // 2. Read
      const list = (await adapter.execute('list-dns-records', {
        zoneId: 'cf_zone_hamzashaikhai',
        type: 'A',
      })) as any;
      expect(list.records.some((r: any) => r.id === recId)).toBe(true);

      // 3. Update
      const updated = (await adapter.execute('update-dns-record', {
        recordId: recId,
        content: '5.6.7.8',
      })) as any;
      expect(updated.success).toBe(true);
      expect(updated.record.content).toBe('5.6.7.8');

      // 4. Delete
      const deleted = (await adapter.execute('delete-dns-record', { recordId: recId })) as any;
      expect(deleted.success).toBe(true);
      expect(deleted.recordId).toBe(recId);
    });

    it('exports BIND zone file format', async () => {
      const res = (await adapter.execute('export-dns-records', { zoneId: 'cf_zone_hamzashaikhai' })) as any;
      expect(res.success).toBe(true);
      expect(res.bindFormat).toContain('$ORIGIN hamzashaikhai.com.');
      expect(res.bindFormat).toContain('IN A');
    });

    it('inspects and toggles DNSSEC', async () => {
      const before = (await adapter.execute('get-dnssec-status', { zoneId: 'cf_zone_hamzashaikhai' })) as any;
      expect(before.success).toBe(true);
      expect(before.dnssec.status).toBe('active');

      const toggled = (await adapter.execute('toggle-dnssec', { zoneId: 'cf_zone_hamzashaikhai' })) as any;
      expect(toggled.success).toBe(true);
      expect(toggled.status).toBe('disabled');
    });
  });

  describe('Workers, Pages & Serverless Compute', () => {
    it('lists workers and uploads new worker script', async () => {
      const initial = (await adapter.execute('list-workers')) as any;
      expect(initial.success).toBe(true);
      expect(initial.workers.length).toBeGreaterThanOrEqual(1);

      const deployed = (await adapter.execute('upload-worker', {
        name: 'custom-auth-gate',
        script: 'export default { fetch() { return new Response("OK"); } };',
        routes: ['hamzashaikhai.com/auth/*'],
      })) as any;
      expect(deployed.success).toBe(true);
      expect(deployed.worker.id).toBe('custom-auth-gate');

      const details = (await adapter.execute('get-worker-details', { workerId: 'custom-auth-gate' })) as any;
      expect(details.worker.id).toBe('custom-auth-gate');

      const deleted = (await adapter.execute('delete-worker', { workerId: 'custom-auth-gate' })) as any;
      expect(deleted.success).toBe(true);
    });

    it('manages worker routes and pages projects', async () => {
      const routes = (await adapter.execute('list-worker-routes')) as any;
      expect(routes.success).toBe(true);

      const createdRoute = (await adapter.execute('create-worker-route', {
        pattern: 'hamzashaikhai.com/v2/*',
        script: 'agentforge-edge-proxy',
      })) as any;
      expect(createdRoute.success).toBe(true);

      const pages = (await adapter.execute('list-pages-projects')) as any;
      expect(pages.success).toBe(true);
      expect(pages.projects[0].name).toBe('agentforge-web');

      const dep = (await adapter.execute('create-pages-deployment', { project: 'agentforge-web' })) as any;
      expect(dep.success).toBe(true);
      expect(dep.url).toBe('https://agentforge-web.pages.dev');
    });
  });

  describe('Workers KV, D1 SQL & R2 Object Storage', () => {
    it('handles KV namespaces and key-value read/write/delete', async () => {
      const namespaces = (await adapter.execute('list-kv-namespaces')) as any;
      expect(namespaces.success).toBe(true);
      const nsId = namespaces.namespaces[0].id;

      // Put
      await adapter.execute('put-kv-value', {
        namespaceId: nsId,
        key: 'session:user_123',
        value: JSON.stringify({ role: 'admin' }),
      });

      // Get
      const read = (await adapter.execute('get-kv-value', {
        namespaceId: nsId,
        key: 'session:user_123',
      })) as any;
      expect(read.success).toBe(true);
      expect(read.found).toBe(true);
      expect(read.value).toContain('admin');

      // Delete
      const del = (await adapter.execute('delete-kv-value', {
        namespaceId: nsId,
        key: 'session:user_123',
      })) as any;
      expect(del.success).toBe(true);
    });

    it('lists and executes queries on D1 databases', async () => {
      const d1List = (await adapter.execute('list-d1-databases')) as any;
      expect(d1List.success).toBe(true);
      expect(d1List.databases.length).toBeGreaterThanOrEqual(1);

      const queryRes = (await adapter.execute('execute-d1-query', {
        sql: 'SELECT COUNT(*) as count FROM users;',
      })) as any;
      expect(queryRes.success).toBe(true);
      expect(queryRes.results).toBeDefined();
    });

    it('lists and creates R2 storage buckets', async () => {
      const r2List = (await adapter.execute('list-r2-buckets')) as any;
      expect(r2List.success).toBe(true);

      const createdBucket = (await adapter.execute('create-r2-bucket', { name: 'backup-data' })) as any;
      expect(createdBucket.success).toBe(true);
      expect(createdBucket.bucket.name).toBe('backup-data');

      const meta = (await adapter.execute('get-r2-object-metadata', { bucket: 'agentforge-assets', key: 'logo.png' })) as any;
      expect(meta.success).toBe(true);
      expect(meta.contentType).toBe('image/png');
    });
  });

  describe('Security, WAF, SSL & Cache Purging', () => {
    it('manages WAF rules and IP access lists', async () => {
      const waf = (await adapter.execute('list-waf-rules')) as any;
      expect(waf.success).toBe(true);
      expect(waf.rules.length).toBeGreaterThanOrEqual(1);

      const ipRule = (await adapter.execute('create-ip-access-rule', { ip: '198.51.100.5', mode: 'whitelist' })) as any;
      expect(ipRule.success).toBe(true);
      expect(ipRule.rule.mode).toBe('whitelist');

      const secAnalytics = (await adapter.execute('get-security-analytics')) as any;
      expect(secAnalytics.success).toBe(true);
      expect(secAnalytics.threats_total).toBeGreaterThan(0);
    });

    it('purges edge cache completely and by files', async () => {
      const purgeAll = (await adapter.execute('purge-cache', { all: true })) as any;
      expect(purgeAll.success).toBe(true);
      expect(purgeAll.purgedEverything).toBe(true);

      const purgeFiles = (await adapter.execute('purge-cache', { files: ['https://hamzashaikhai.com/style.css'] })) as any;
      expect(purgeFiles.success).toBe(true);
      expect(purgeFiles.purgedEverything).toBe(false);
      expect(purgeFiles.filesPurged).toContain('https://hamzashaikhai.com/style.css');

      const devMode = (await adapter.execute('toggle-development-mode', { enabled: true })) as any;
      expect(devMode.success).toBe(true);
      expect(devMode.development_mode).toBe('on');
    });

    it('dispatches universal raw REST API v4 calls', async () => {
      const rawRes = (await adapter.execute('cloudflare-raw-api', {
        endpoint: '/zones',
        method: 'GET',
      })) as any;
      expect(rawRes.success).toBe(true);
      expect(rawRes.endpoint).toBe('/zones');
    });
  });
});
