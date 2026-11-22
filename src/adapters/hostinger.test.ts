import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HostingerAdapter } from './hostinger.js';
import { BridgeValidator } from '../bridge-validator.js';

describe('HostingerAdapter & Bridge Manifest (Omni-Platform Capabilities)', () => {
  let adapter: HostingerAdapter;

  beforeEach(() => {
    adapter = new HostingerAdapter();
  });

  describe('Manifest Schema Validation', () => {
    it('validates bridges/hostinger/bridge.json with 0 errors across all 39 capabilities', () => {
      const manifestPath = resolve(process.cwd(), 'bridges', 'hostinger', 'bridge.json');
      const raw = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);

      const validator = new BridgeValidator();
      const result = validator.validate(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(manifest.name).toBe('hostinger');
      expect(manifest.capabilities.length).toBe(39);
    });
  });

  describe('Adapter Metadata & Actions', () => {
    it('exposes correct metadata', () => {
      expect(adapter.name).toBe('hostinger');
      expect(adapter.displayName).toBe('Hostinger');
      expect(adapter.category).toBe('cloud-services');
      expect(adapter.version).toBe('1.0.0');
    });

    it('declares 39 supported actions matching the manifest', () => {
      const actions = adapter.getActions();
      expect(actions).toHaveLength(39);

      const actionNames = actions.map((a) => a.action);
      expect(actionNames).toContain('get-account-info');
      expect(actionNames).toContain('list-hosting-orders');
      expect(actionNames).toContain('create-dns-record');
      expect(actionNames).toContain('deploy-static-site');
      expect(actionNames).toContain('create-database');
      expect(actionNames).toContain('install-ssl');
      expect(actionNames).toContain('restart-vps');
      expect(actionNames).toContain('hostinger-raw-api');
    });

    it('enforces requiresApproval on sensitive operations', () => {
      const actions = adapter.getActions();
      const deleteDns = actions.find((a) => a.action === 'delete-dns-record');
      expect(deleteDns?.requiresApproval).toBe(true);
      expect(deleteDns?.permissionLevel).toBe('destructive');

      const deploySite = actions.find((a) => a.action === 'deploy-static-site');
      expect(deploySite?.requiresApproval).toBe(true);
      expect(deploySite?.permissionLevel).toBe('publish');

      const restartVps = actions.find((a) => a.action === 'restart-vps');
      expect(restartVps?.requiresApproval).toBe(true);
    });
  });

  describe('Health Checks', () => {
    it('reports available status in local simulation mode without token', async () => {
      const health = await adapter.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.status).toBe('available');
      expect(health.message).toContain('local simulation mode');
    });

    it('reports connected status when token is provided', async () => {
      const tokenAdapter = new HostingerAdapter({ apiToken: 'hst_secret_token_live' });
      const health = await tokenAdapter.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.status).toBe('connected');
    });
  });

  describe('Execution of Core Capabilities', () => {
    it('retrieves account info and active invoices', async () => {
      const acc = (await adapter.execute('get-account-info')) as any;
      expect(acc.success).toBe(true);
      expect(acc.account.name).toBe('AgentForge Operator');

      const invoices = (await adapter.execute('list-invoices')) as any;
      expect(invoices.success).toBe(true);
      expect(invoices.invoices.length).toBeGreaterThan(0);
    });

    it('manages hosting orders and server configurations', async () => {
      const orders = (await adapter.execute('list-hosting-orders')) as any;
      expect(orders.success).toBe(true);
      expect(orders.orders.length).toBeGreaterThan(0);

      const single = (await adapter.execute('get-hosting-order', { orderId: orders.orders[0].id })) as any;
      expect(single.success).toBe(true);
      expect(single.order.domain).toBe('hamzashaikhai.com');
    });

    it('checks domain availability and updates nameservers', async () => {
      const avail = (await adapter.execute('check-domain-availability', { domain: 'new-awesome-project-xyz.dev' })) as any;
      expect(avail.available).toBe(true);
      expect(avail.price).toBe(12.99);

      const updateNs = (await adapter.execute('update-nameservers', {
        domain: 'hamzashaikhai.com',
        nameservers: ['ns1.custom-dns.com', 'ns2.custom-dns.com'],
      })) as any;
      expect(updateNs.success).toBe(true);
      expect(updateNs.nameservers).toContain('ns1.custom-dns.com');
    });

    it('manages DNS records (list, create, update, delete)', async () => {
      const list = (await adapter.execute('list-dns-records', { domain: 'hamzashaikhai.com' })) as any;
      expect(list.success).toBe(true);
      const initialCount = list.count;

      const created = (await adapter.execute('create-dns-record', {
        domain: 'hamzashaikhai.com',
        type: 'A',
        name: 'api',
        content: '185.199.108.200',
        ttl: 3600,
      })) as any;
      expect(created.success).toBe(true);
      expect(created.record.name).toBe('api');

      const updated = (await adapter.execute('update-dns-record', {
        id: created.record.id,
        content: '185.199.108.201',
      })) as any;
      expect(updated.success).toBe(true);
      expect(updated.record.content).toBe('185.199.108.201');

      const deleted = (await adapter.execute('delete-dns-record', { id: created.record.id })) as any;
      expect(deleted.success).toBe(true);
      expect(deleted.deleted).toBe(true);
    });

    it('manages website slots, PHP runtimes, and static deployments', async () => {
      const sites = (await adapter.execute('list-websites')) as any;
      expect(sites.success).toBe(true);

      const phpUpdate = (await adapter.execute('set-php-version', { domain: 'hamzashaikhai.com', phpVersion: '8.3' })) as any;
      expect(phpUpdate.success).toBe(true);
      expect(phpUpdate.phpVersion).toBe('8.3');

      const deploy = (await adapter.execute('deploy-static-site', { domain: 'hamzashaikhai.com', buildDir: './dist' })) as any;
      expect(deploy.success).toBe(true);
      expect(deploy.url).toBe('https://hamzashaikhai.com');
      expect(deploy.deployedFiles).toBe(24);
    });

    it('provisions MySQL databases and manages database users', async () => {
      const newDb = (await adapter.execute('create-database', { name: 'u123_shop', username: 'u123_shop_admin' })) as any;
      expect(newDb.success).toBe(true);
      expect(newDb.database.name).toBe('u123_shop');

      const dbs = (await adapter.execute('list-databases')) as any;
      expect(dbs.databases.some((d: any) => d.id === newDb.database.id)).toBe(true);

      const deleted = (await adapter.execute('delete-database', { id: newDb.database.id })) as any;
      expect(deleted.success).toBe(true);
    });

    it('provisions SSL certificates and manages mailboxes', async () => {
      const ssl = (await adapter.execute('get-ssl-status', { domain: 'hamzashaikhai.com' })) as any;
      expect(ssl.success).toBe(true);
      expect(ssl.installed).toBe(true);

      const mb = (await adapter.execute('create-email-mailbox', { email: 'hello@hamzashaikhai.com' })) as any;
      expect(mb.success).toBe(true);
      expect(mb.mailbox.email).toBe('hello@hamzashaikhai.com');
    });

    it('controls VPS lifecycle (status, start, restart, stop)', async () => {
      const vps = (await adapter.execute('list-vps')) as any;
      expect(vps.success).toBe(true);
      const vpsId = vps.vpsList[0].id;

      const reboot = (await adapter.execute('restart-vps', { id: vpsId })) as any;
      expect(reboot.success).toBe(true);
      expect(reboot.status).toBe('restarted');

      const stop = (await adapter.execute('stop-vps', { id: vpsId })) as any;
      expect(stop.status).toBe('stopped');

      const start = (await adapter.execute('start-vps', { id: vpsId })) as any;
      expect(start.status).toBe('running');
    });

    it('dispatches universal raw REST API calls', async () => {
      const raw = (await adapter.execute('hostinger-raw-api', {
        endpoint: '/v1/hosting/orders',
        method: 'GET',
      })) as any;
      expect(raw.success).toBe(true);
      expect(raw.endpoint).toBe('/v1/hosting/orders');
    });

    it('throws error for unknown actions', async () => {
      await expect(adapter.execute('invalid-action', {})).rejects.toThrow('is not implemented by HostingerAdapter');
    });
  });
});
