import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NorthwestAdapter, DnsRecord } from './northwest.js';
import { BridgeValidator } from '../bridge-validator.js';

describe('NorthwestAdapter & Bridge Manifest (Omni-Control)', () => {
  let adapter: NorthwestAdapter;

  beforeEach(() => {
    adapter = new NorthwestAdapter();
  });

  describe('Manifest Schema Validation', () => {
    it('validates bridges/northwest/bridge.json with 0 errors across all 19 capabilities', () => {
      const manifestPath = resolve(process.cwd(), 'bridges', 'northwest', 'bridge.json');
      const raw = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);

      const validator = new BridgeValidator();
      const result = validator.validate(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(manifest.name).toBe('northwest');
      expect(manifest.capabilities.length).toBe(19);
    });
  });

  describe('Adapter Metadata & Actions', () => {
    it('exposes correct metadata', () => {
      expect(adapter.name).toBe('northwest');
      expect(adapter.displayName).toBe('Northwest Registered Agent');
      expect(adapter.category).toBe('cloud-services');
      expect(adapter.version).toBe('1.0.0');
    });

    it('declares all 19 supported actions with strict permission policies', () => {
      const actions = adapter.getActions();
      expect(actions).toHaveLength(19);

      const readActions = ['get-domain', 'list-domains', 'get-dns-records', 'check-domain-availability', 'get-compliance-status', 'list-scanned-documents'];
      for (const a of readActions) {
        const found = actions.find(x => x.action === a);
        expect(found?.permissionLevel).toBe('read');
        expect(found?.requiresApproval).toBe(false);
      }

      const externalWriteActions = [
        'add-dns-record',
        'update-dns-record',
        'link-website-hosting',
        'set-registrar-lock',
        'set-privacy-protection',
        'set-auto-renew',
        'set-nameservers',
        'set-url-forwarding',
        'configure-email-forwarding',
        'manage-ssl',
        'deploy-ai-website',
        'universal-control',
      ];
      for (const a of externalWriteActions) {
        const found = actions.find(x => x.action === a);
        expect(found?.permissionLevel).toBe('external-write');
        expect(found?.requiresApproval).toBe(true);
      }

      const deleteDns = actions.find(a => a.action === 'delete-dns-record');
      expect(deleteDns?.permissionLevel).toBe('destructive');
      expect(deleteDns?.requiresApproval).toBe(true);
    });

    it('returns healthy status via checkHealth() with managed domain details', async () => {
      const health = await adapter.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.status).toBe('connected');
      expect(health.details?.managedDomain).toBe('hamzashaikhai.com');
      expect(health.details?.autoRenew).toBe(true);
      expect(health.details?.privacyProtection).toBe(true);
    });
  });

  describe('Omni-Control Action Execution', () => {
    it('executes get-domain for hamzashaikhai.com', async () => {
      const res = (await adapter.execute('get-domain', {
        domain: 'hamzashaikhai.com',
      })) as any;

      expect(res.domain).toBe('hamzashaikhai.com');
      expect(res.domainStatus).toBe('Active');
      expect(res.ssl).toBe('Included');
      expect(res.registrarLock).toBe(false);
      expect(res.privacyProtection).toBe(true);
      expect(res.autoRenew).toBe(true);
    });

    it('toggles registrar lock on and off', async () => {
      const lockOn = (await adapter.execute('set-registrar-lock', {
        domain: 'hamzashaikhai.com',
        locked: true,
      })) as any;
      expect(lockOn.success).toBe(true);
      expect(lockOn.registrarLock).toBe(true);

      const check1 = (await adapter.execute('get-domain')) as any;
      expect(check1.registrarLock).toBe(true);

      const lockOff = (await adapter.execute('set-registrar-lock', {
        domain: 'hamzashaikhai.com',
        locked: false,
      })) as any;
      expect(lockOff.success).toBe(true);
      expect(lockOff.registrarLock).toBe(false);
    });

    it('manages WHOIS privacy and auto-renewal', async () => {
      const privRes = (await adapter.execute('set-privacy-protection', {
        domain: 'hamzashaikhai.com',
        enabled: false,
      })) as any;
      expect(privRes.success).toBe(true);
      expect(privRes.privacyProtection).toBe(false);

      const renewRes = (await adapter.execute('set-auto-renew', {
        domain: 'hamzashaikhai.com',
        enabled: true,
      })) as any;
      expect(renewRes.success).toBe(true);
      expect(renewRes.autoRenew).toBe(true);
    });

    it('configures custom authoritative nameservers', async () => {
      const nsRes = (await adapter.execute('set-nameservers', {
        domain: 'hamzashaikhai.com',
        nameservers: ['cloe.ns.cloudflare.com', 'walt.ns.cloudflare.com'],
      })) as any;
      expect(nsRes.success).toBe(true);
      expect(nsRes.nameservers).toContain('cloe.ns.cloudflare.com');
    });

    it('configures URL forwarding and email routing', async () => {
      const urlRes = (await adapter.execute('set-url-forwarding', {
        domain: 'hamzashaikhai.com',
        targetUrl: 'https://antigravity.ai/hamza',
        redirectType: '301',
      })) as any;
      expect(urlRes.success).toBe(true);
      expect(urlRes.targetUrl).toBe('https://antigravity.ai/hamza');

      const mailRes = (await adapter.execute('configure-email-forwarding', {
        domain: 'hamzashaikhai.com',
        alias: 'ai',
        destinationEmail: 'indefect397@gmail.com',
      })) as any;
      expect(mailRes.success).toBe(true);
      expect(mailRes.fromEmail).toBe('ai@hamzashaikhai.com');
      expect(mailRes.destinationEmail).toBe('indefect397@gmail.com');
    });

    it('manages SSL certificates and HTTPS enforcement', async () => {
      const sslRes = (await adapter.execute('manage-ssl', {
        domain: 'hamzashaikhai.com',
        action: 'enforce-https',
      })) as any;
      expect(sslRes.success).toBe(true);
      expect(sslRes.enforceHttps).toBe(true);
    });

    it('retrieves compliance status and scanned documents', async () => {
      const compliance = (await adapter.execute('get-compliance-status')) as any;
      expect(compliance.standing).toBe('Good Standing');
      expect(compliance.registeredAgent).toContain('Northwest');

      const docs = (await adapter.execute('list-scanned-documents')) as any;
      expect(docs.totalCount).toBeGreaterThanOrEqual(2);
      expect(docs.documents[0].title).toBeDefined();
    });

    it('deploys full AI website via deploy-ai-website', async () => {
      const deployRes = (await adapter.execute('deploy-ai-website', {
        domain: 'hamzashaikhai.com',
        siteTitle: 'Hamza Shaikh — AI Architect',
        template: 'portfolio',
        provider: 'vercel',
      })) as any;

      expect(deployRes.success).toBe(true);
      expect(deployRes.liveUrl).toBe('https://hamzashaikhai.com');
      expect(deployRes.dnsSynced).toBe(true);
    });

    it('executes arbitrary dynamic operations via universal-control', async () => {
      const omniRes = (await adapter.execute('universal-control', {
        domain: 'hamzashaikhai.com',
        category: 'security',
        operation: 'lock',
      })) as any;

      expect(omniRes.success).toBe(true);
      expect(omniRes.category).toBe('security');
      expect(omniRes.operation).toBe('lock');
      expect(omniRes.result.registrarLock).toBe(true);
    });
  });
});
