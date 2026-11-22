import React, { useState } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Shield,
  Key,
  Eye,
  EyeOff,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Trash2,
  Settings,
  Database,
  Globe,
  Code2,
  Zap,
  FileText,
  Search,
  Filter,
  Download,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '@/lib/query';
import { formatRelativeTime } from '@/lib/utils';

interface CredentialStatus {
  provider: string;
  connected: boolean;
  account?: string;
  scopes?: string[];
  expiresAt?: string;
  lastRotated?: string;
  encryptionStatus: 'encrypted' | 'plaintext' | 'unknown';
  healthScore: number;
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  event: string;
  provider?: string;
  details: string;
  severity: 'info' | 'warning' | 'error';
  ip?: string;
}

const PROVIDER_CONFIG = {
  google: { name: 'Google', icon: Globe, color: 'bg-gradient-brand', scopes: ['email', 'profile', 'drive', 'youtube'] },
  linkedin: { name: 'LinkedIn', icon: Globe, color: 'bg-blue-600', scopes: ['r_liteprofile', 'r_emailaddress', 'w_member_social'] },
  x: { name: 'X (Twitter)', icon: Globe, color: 'bg-neutral-900', scopes: ['tweet.read', 'tweet.write', 'users.read'] },
  dpapi: { name: 'Windows DPAPI', icon: Database, color: 'bg-gradient-tech', scopes: [] },
};

const SEVERITY_CONFIG = {
  info: { color: 'text-tech-500', dot: 'bg-tech-500', icon: Code2 },
  warning: { color: 'text-warm-500', dot: 'bg-warm-500', icon: AlertTriangle },
  error: { color: 'text-brand-500', dot: 'bg-brand-500', icon: XCircle },
};

function CredentialHealthCard({ status }: { status: CredentialStatus }) {
  const config = PROVIDER_CONFIG[status.provider as keyof typeof PROVIDER_CONFIG] || { name: status.provider, icon: Key, color: 'bg-gradient-brand' };
  const Icon = config.icon;

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-success-500';
    if (score >= 50) return 'text-warm-500';
    return 'text-brand-500';
  };

  return (
    <article className="card p-5 hover:shadow-2 transition-all">
      <div className="flex items-start gap-4 mb-4">
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0', config.color)}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-primary">{config.name}</h3>
          <span className={cn('badge text-tiny', status.connected ? 'badge-verified' : 'badge-pending')}>
            {status.connected ? 'Connected' : 'Not Connected'}
          </span>
        </div>
        <div className="flex-shrink-0">
          <div className="text-2xl font-bold font-data text-primary">{status.healthScore}</div>
          <div className="text-xs text-muted">Health Score</div>
        </div>
      </div>

      {status.connected && (
        <div className="space-y-2 text-sm">
          {status.account && (
            <div className="flex items-center gap-2 text-secondary">
              <span className="text-muted">Account:</span>
              <span className="font-mono text-primary">{status.account}</span>
            </div>
          )}
          {status.scopes && status.scopes.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted">Scopes:</span>
              <div className="flex flex-wrap gap-1">
                {status.scopes.map((scope) => (
                  <span key={scope} className="badge badge-read text-tiny">{scope}</span>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-secondary">
            <span className="text-muted">Encryption:</span>
            <span className={cn('badge text-tiny', status.encryptionStatus === 'encrypted' ? 'badge-verified' : 'badge-blocked')}>
              {status.encryptionStatus}
            </span>
          </div>
          {status.expiresAt && (
            <div className="flex items-center gap-2 text-secondary">
              <span className="text-muted">Expires:</span>
              <span className="font-mono text-primary">{new Date(status.expiresAt).toLocaleDateString()}</span>
              <span className="text-xs text-muted">({formatRelativeTime(status.expiresAt)})</span>
            </div>
          )}
          {status.lastRotated && (
            <div className="flex items-center gap-2 text-secondary">
              <span className="text-muted">Last Rotated:</span>
              <span className="font-mono text-primary">{formatRelativeTime(status.lastRotated)}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-hairline">
        <div className="h-2 bg-hover rounded-full overflow-hidden flex-1 mr-4 max-w-xs">
          <div
            className={cn('h-full rounded-full transition-all duration-500', getScoreColor(status.healthScore).replace('text-', 'bg-'))}
            style={{ width: `${status.healthScore}%` }}
          />
        </div>
        <div className="flex items-center gap-2">
          {!status.connected && (
            <button className="btn btn-primary btn-sm gap-1">
              <Plus className="w-3 h-3" />
              Connect
            </button>
          )}
          {status.connected && (
            <>
              <button className="btn btn-outline btn-sm gap-1" aria-label="Rotate credentials">
                <RefreshCw className="w-3 h-3" />
                Rotate
              </button>
              <button className="btn btn-outline btn-sm gap-1 text-brand-500 border-brand-500/30 hover:bg-brand-500/10" aria-label="Disconnect">
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function RedactionPlayground() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [patterns, setPatterns] = useState<string[]>([]);

  const redact = (text: string): { redacted: string; found: string[] } => {
    const patterns: { regex: RegExp; label: string }[] = [
      { regex: /ya29\.[a-zA-Z0-9_-]+/g, label: 'Google OAuth Token' },
      { regex: /ghp_[a-zA-Z0-9]{36}/g, label: 'GitHub PAT' },
      { regex: /gho_[a-zA-Z0-9]{36}/g, label: 'GitHub OAuth Token' },
      { regex: /ghu_[a-zA-Z0-9]{36}/g, label: 'GitHub User Token' },
      { regex: /ghs_[a-zA-Z0-9]{36}/g, label: 'GitHub Secret' },
      { regex: /sk_live_[a-zA-Z0-9]{24}/g, label: 'Stripe Secret Key' },
      { regex: /sk_test_[a-zA-Z0-9]{24}/g, label: 'Stripe Test Key' },
      { regex: /Bearer\s+[a-zA-Z0-9._-]+/g, label: 'Bearer Token' },
      { regex: /xoxb-[a-zA-Z0-9-]+/g, label: 'Slack Bot Token' },
      { regex: /xoxp-[a-zA-Z0-9-]+/g, label: 'Slack User Token' },
      { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: 'Email Address' },
      { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, label: 'IP Address' },
      { regex: /(?:password|secret|key|token)["'\s:=]+([^\s"']+)/gi, label: 'Key-Value Secret' },
    ];

    let redacted = text;
    const found: string[] = [];

    for (const { regex, label } of patterns) {
      const matches = text.match(regex);
      if (matches) {
        found.push(...matches.map(m => `${label}: ${m.slice(0, 20)}...`));
        redacted = redacted.replace(regex, (match) => '█'.repeat(Math.min(match.length, 32)));
      }
    }

    return { redacted, found: [...new Set(found)] };
  };

  const handleRedact = () => {
    const { redacted, found } = redact(input);
    setOutput(redacted);
    setPatterns(found);
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  const loadSample = () => {
    const sample = `POST /api/token
Authorization: Bearer ya29.EXAMPLE_BEARER_TOKEN_SAMPLE
X-API-Key: sk_live_EXAMPLE_SECRET_KEY_SAMPLE
Content-Type: application/json

{
  "access_token": "ghp_EXAMPLE_GITHUB_TOKEN_SAMPLE",
  "refresh_token": "ghr_EXAMPLE_REFRESH_TOKEN_SAMPLE",
  "token_type": "Bearer",
  "expires_in": 3600
}

ERROR: Failed to authenticate user john.doe@company.com from IP 192.168.1.100`;
    setInput(sample);
    handleRedact();
  };

  return (
    <article className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-primary">Secret Redaction Playground</h3>
          <p className="text-sm text-muted">Test how AgentForge masks sensitive tokens before logging</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline btn-sm" onClick={loadSample}>
            <FileText className="w-4 h-4 mr-1" />
            Load Sample
          </button>
          <button className="btn btn-primary" onClick={handleRedact} disabled={!input.trim()}>
            <Shield className="w-4 h-4 mr-1" />
            Redact
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted mb-2">Input (paste logs, config, tokens)</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={12}
            className="input font-mono text-xs min-h-[200px] resize-y"
            placeholder="Paste sample text containing access tokens, API keys, bearer tokens..."
            spellCheck={false}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-2">Output (redacted)</label>
          <div className="relative">
            <pre className="input font-mono text-xs min-h-[200px] p-3 bg-bg-input rounded-xl border border-subtle overflow-x-auto whitespace-pre-wrap text-success-500">
              {output || 'Redacted output will appear here...'}
            </pre>
            {output && (
              <button
                onClick={() => handleCopy(output)}
                className="absolute top-2 right-2 btn btn-ghost btn-sm p-1"
                aria-label="Copy redacted output"
              >
                <Copy className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {patterns.length > 0 && (
        <div className="mt-4 p-3 bg-brand-500/10 border border-brand-500/20 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-brand-500" />
            <span className="text-xs font-bold text-brand-500 uppercase tracking-wider">Patterns Detected: {patterns.length}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {patterns.map((p, i) => (
              <span key={i} className="badge badge-publish text-tiny">{p}</span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function AuditLog() {
  const { data: logs } = useQuery({
    queryKey: queryKeys.auditLog(),
    queryFn: () => api.get<AuditLogEntry[]>('/api/security/audit'),
  });

  if (!logs) return <div className="card p-8 text-center text-muted">Loading audit log...</div>;

  return (
    <article className="card overflow-hidden">
      <div className="p-4 border-b border-subtle flex items-center justify-between">
        <h2 className="text-h3 font-semibold text-primary">Security Audit Log</h2>
        <div className="flex gap-2">
          <button className="btn btn-outline btn-sm gap-1">
            <Download className="w-4 h-4" />
            Export
          </button>
          <button className="btn btn-outline btn-sm gap-1">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full" role="table">
          <thead className="bg-hover border-b border-subtle">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Time</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Event</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Provider</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Details</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Severity</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {logs.map((log) => {
              const severity = SEVERITY_CONFIG[log.severity];
              const SeverityIcon = severity.icon;
              return (
                <tr key={log.id} className="hover:bg-hover transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-secondary">{formatRelativeTime(log.timestamp)}</td>
                  <td className="px-4 py-3 text-sm text-primary">{log.event}</td>
                  <td className="px-4 py-3">
                    {log.provider && (
                      <span className="badge badge-declared text-tiny">{log.provider}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary max-w-xs truncate">{log.details}</td>
                  <td className="px-4 py-3">
                    <span className={cn('flex items-center gap-1.5', severity.color)}>
                      <SeverityIcon className={cn('w-3 h-3', severity.dot)} />
                      {log.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-muted">{log.ip || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {logs.length === 0 && (
        <div className="p-8 text-center text-muted">No audit entries found</div>
      )}
    </article>
  );
}

export function Security() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pathPart = location.pathname.split('/')[2];
  const tab = pathPart || searchParams.get('tab') || 'vault';

  const tabs = [
    { id: 'vault', label: 'Credential Vault', icon: Shield },
    { id: 'redaction', label: 'Redaction Playground', icon: Eye },
    { id: 'audit', label: 'Audit Log', icon: Code2 },
  ];

  const { data: credentials } = useQuery({
    queryKey: queryKeys.vaultStatus(),
    queryFn: () => api.get<CredentialStatus[]>('/api/auth/status'),
  });

  return (
    <div className="space-y-6">
      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(`/security/${t.id}`)}
            className={cn(
              'btn btn-sm transition-all duration-200 ease-spring whitespace-nowrap px-4 py-2',
              'relative',
              tab === t.id
                ? 'text-primary bg-gradient-brand-subtle border-brand'
                : 'text-secondary hover:text-primary hover:bg-hover border-transparent'
            )}
            role="tab"
            aria-selected={tab === t.id}
          >
            <t.icon className="w-4 h-4 mr-2" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'vault' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-h2 font-bold text-primary">Credential Vault</h1>
            <p className="text-sm text-muted">Local-first DPAPI encryption. Tokens never leave your machine.</p>
          </div>

          {credentials ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {credentials.map((cred) => (
                <CredentialHealthCard key={cred.provider} status={cred} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(PROVIDER_CONFIG).map(([key, config]) => (
                <CredentialHealthCard
                  key={key}
                  status={{
                    provider: key,
                    connected: false,
                    encryptionStatus: 'unknown',
                    healthScore: 0,
                  }}
                />
              ))}
            </div>
          )}

          {/* DPAPI Info */}
          <article className="card p-5 border-l-4 border-l-tech-500">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-tech flex items-center justify-center flex-shrink-0">
                <Database className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-primary mb-1">Windows DPAPI Storage</h3>
                <p className="text-sm text-muted">All credentials are encrypted using Windows Data Protection API (CryptProtectData) with your user credentials as the entropy. Keys are bound to your local user account and cannot be decrypted on another machine or by another user.</p>
              </div>
            </div>
          </article>
        </div>
      )}

      {tab === 'redaction' && (
        <div className="space-y-6">
          <RedactionPlayground />
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-6">
          <AuditLog />
        </div>
      )}
    </div>
  );
}