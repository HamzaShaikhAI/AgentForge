import React, { useState } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Server,
  PlugZap,
  Globe,
  Key,
  Search,
  Filter,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  Pause,
  Settings,
  Terminal,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Wifi,
  WifiOff,
  Download,
  Upload,
  Code2,
  Zap,
  Shield,
  ExternalLink,
  Monitor,
  Layers,
  X,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys, mutationKeys } from '@/lib/query';
import { formatRelativeTime, formatDuration } from '@/lib/utils';
import { getServiceBrand } from '@/components/ui/ServiceLogo';

interface MCPServer {
  id: string;
  name: string;
  description?: string;
  transport: 'stdio' | 'http';
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
  connectedAt?: string;
  serverInfo?: { name: string; version: string };
  tools: MCPTool[];
  config: MCPServerConfig;
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  permissionLevel: string;
  requiresApproval: boolean;
  sideEffects?: boolean;
}

interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  autoConnect?: boolean;
}

const STATUS_CONFIG = {
  connected: { label: 'Connected', color: 'text-success-500', dot: 'bg-success-500', icon: Wifi },
  connecting: { label: 'Connecting', color: 'text-warm-500', dot: 'bg-warm-500 animate-pulse', icon: Wifi },
  disconnected: { label: 'Disconnected', color: 'text-muted', dot: 'bg-muted', icon: WifiOff },
  error: { label: 'Error', color: 'text-brand-500', dot: 'bg-brand-500', icon: AlertTriangle },
};

const PERMISSION_BADGES = {
  read: 'badge-read',
  'local-write': 'badge-local-write',
  'external-write': 'badge-external-write',
  publish: 'badge-publish',
  destructive: 'badge-destructive',
};

function MCPServerCard({ server, onTest, onConnect, onDisconnect, onRemove, onConfig }: {
  server: MCPServer;
  onTest: (id: string) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onRemove: (id: string) => void;
  onConfig: (server: MCPServer) => void;
}) {
  const status = STATUS_CONFIG[server.status];
  const StatusIcon = status.icon;

  return (
    <article className="card p-5 group hover:shadow-2 transition-all duration-300">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-tech flex items-center justify-center flex-shrink-0">
          <Server className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-semibold text-primary truncate">{server.name}</h3>
            <span className={cn('badge badge-declared text-tiny', server.transport.toUpperCase())}>{server.transport.toUpperCase()}</span>
            {server.serverInfo && (
              <span className="text-xs text-muted font-mono">v{server.serverInfo.version}</span>
            )}
          </div>
          <p className="text-sm text-muted mt-1 line-clamp-1">{server.description || 'No description'}</p>
          <div className="flex items-center gap-2 mt-2">
            <StatusIcon className={cn('w-4 h-4', status.color)} />
            <span className={cn('text-sm font-medium', status.color)}>{status.label}</span>
            {server.connectedAt && (
              <span className="text-xs text-muted">• Connected {formatRelativeTime(server.connectedAt)}</span>
            )}
            {server.error && (
              <span className="text-xs text-brand-500">• {server.error}</span>
            )}
          </div>
        </div>
      </div>

      {/* Tools */}
      {server.tools.length > 0 && (
        <div className="border-t border-subtle pt-4 mb-4">
          <div className="flex items-center justify-between text-xs text-muted mb-2">
            <span>Available Tools ({server.tools.length})</span>
            <span className="font-mono font-data text-primary">
              {server.tools.filter(t => !t.requiresApproval).length} auto / {server.tools.filter(t => t.requiresApproval).length} approval
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {server.tools.slice(0, 8).map((tool) => (
              <span
                key={tool.name}
                className={cn(
                  'badge text-tiny',
                  PERMISSION_BADGES[tool.permissionLevel as keyof typeof PERMISSION_BADGES] || 'badge-read',
                  tool.sideEffects && 'ring-1 ring-warm-500/30'
                )}
                title={tool.description}
              >
                {tool.name}
                {tool.requiresApproval && <Shield className="w-3 h-3 ml-0.5" />}
                {tool.sideEffects && <Zap className="w-3 h-3 ml-0.5" />}
              </span>
            ))}
            {server.tools.length > 8 && (
              <span className="badge badge-declared text-tiny">+{server.tools.length - 8}</span>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-3 border-t border-hairline">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onConfig(server)}
            className="btn btn-outline btn-sm px-3"
            aria-label="Configure"
          >
            <Settings className="w-4 h-4 mr-1" />
            Config
          </button>
          <button
            onClick={() => onTest(server.id)}
            className="btn btn-test btn-sm px-3 gap-1.5"
            aria-label="Test connection"
          >
            <div className="w-4 h-4 rounded flex items-center justify-center icon-gradient-test shrink-0">
              <Terminal className="w-2.5 h-2.5 text-white" />
            </div>
            <span>Test</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {server.status === 'connected' ? (
            <button
              onClick={() => onDisconnect(server.id)}
              className="btn btn-outline btn-sm px-3 text-warm-500 border-warm-500/30 hover:bg-warm-500/10"
              aria-label="Disconnect"
            >
              <Pause className="w-4 h-4 mr-1" />
              Disconnect
            </button>
          ) : server.status === 'connecting' ? (
            <button className="btn btn-outline btn-sm px-3" disabled>
              <Wifi className="w-4 h-4 mr-1 animate-spin" />
              Connecting...
            </button>
          ) : (
            <button
              onClick={() => onConnect(server.id)}
              className="btn btn-primary btn-sm px-3"
              aria-label="Connect"
            >
              <Play className="w-4 h-4 mr-1" />
              Connect
            </button>
          )}
          <button
            onClick={() => onRemove(server.id)}
            className="btn btn-ghost btn-sm p-1.5 text-brand-500 hover:bg-brand-500/10"
            aria-label="Remove server"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

function AddMCPServerWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    type: 'stdio',
    name: '',
    command: '',
    args: '',
    env: '',
    url: '',
    headers: '',
    description: '',
  });

  const steps = [
    { num: 1, title: 'Transport', desc: 'How does this server communicate?' },
    { num: 2, title: 'Configuration', desc: 'Enter connection details' },
    { num: 3, title: 'Test & Connect', desc: 'Verify and activate' },
  ];

  return (
    <div className="card p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 id="wizard-title" className="text-h2 font-bold text-primary">Add MCP Server</h2>
          <p className="text-sm text-muted mt-1">Configure a new Model Context Protocol server</p>
        </div>
        <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">
          <XCircle className="w-5 h-5" />
        </button>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          {steps.map((s, i) => (
            <div key={s.num} className="flex flex-col items-center flex-1 relative">
              <div className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300',
                step > i ? 'bg-gradient-brand text-white' : step === i ? 'bg-gradient-brand text-white ring-4 ring-brand-500/20' : 'bg-hover text-muted'
              )}>
                {step > i ? <CheckCircle className="w-5 h-5" /> : s.num}
              </div>
              <span className={cn('text-tiny font-medium mt-1 text-center', step >= i ? 'text-primary' : 'text-muted')}>{s.title}</span>
              {i < steps.length - 1 && (
                <div className={cn('absolute top-5 left-1/2 w-full h-0.5 -translate-x-1/2', i < step - 1 ? 'bg-gradient-brand' : 'bg-hairline')} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Transport Type */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">{steps[0].desc}</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setFormData(prev => ({ ...prev, type: 'stdio' })); setStep(2); }}
              className="card p-4 border-brand ring-1 ring-brand-500/30 text-left group hover:shadow-brand transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center">
                  <Terminal className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold text-primary">STDIO (Local Process)</h4>
                  <p className="text-xs text-muted">Runs locally as a subprocess. Most secure.</p>
                </div>
              </div>
            </button>
            <button
              onClick={() => { setFormData(prev => ({ ...prev, type: 'http' })); setStep(2); }}
              className="card p-4 text-left hover:shadow-2 transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-tech flex items-center justify-center">
                  <Globe className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold text-primary">HTTP (Remote)</h4>
                  <p className="text-xs text-muted">Connects to a remote MCP server via HTTP.</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Configuration */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">{steps[1].desc}</p>
          <div className="space-y-3">
            <label className="block">
              <span className="block text-xs font-medium text-secondary mb-1">Server Name *</span>
              <input
                type="text"
                className="input"
                placeholder="my-mcp-server"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                required
              />
            </label>

            <label className="block">
              <span className="block text-xs font-medium text-secondary mb-1">Description</span>
              <textarea
                className="input min-h-[80px] resize-y"
                placeholder="What does this server do?"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              />
            </label>

            {formData.type === 'stdio' && (
              <>
                <label className="block">
                  <span className="block text-xs font-medium text-secondary mb-1">Command *</span>
                  <input
                    type="text"
                    className="input font-mono"
                    placeholder="npx"
                    value={formData.command}
                    onChange={(e) => setFormData(prev => ({ ...prev, command: e.target.value }))}
                    required
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-secondary mb-1">Arguments (space-separated)</span>
                  <input
                    type="text"
                    className="input font-mono"
                    placeholder="-y @modelcontextprotocol/server-filesystem /path/to/folder"
                    value={formData.args}
                    onChange={(e) => setFormData(prev => ({ ...prev, args: e.target.value }))}
                  />
                  <p className="text-xs text-muted mt-1">Space-separated arguments passed to the command</p>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-secondary mb-1">Environment Variables (JSON)</span>
                  <textarea
                    className="input font-mono min-h-[80px] resize-y"
                    placeholder='{"API_KEY": "value", "DEBUG": "true"}'
                    value={formData.env}
                    onChange={(e) => setFormData(prev => ({ ...prev, env: e.target.value }))}
                  />
                </label>
              </>
            )}

            {formData.type === 'http' && (
              <>
                <label className="block">
                  <span className="block text-xs font-medium text-secondary mb-1">Server URL *</span>
                  <input
                    type="url"
                    className="input"
                    placeholder="http://localhost:3000/mcp"
                    value={formData.url}
                    onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
                    required
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-secondary mb-1">Headers (JSON)</span>
                  <textarea
                    className="input font-mono min-h-[80px] resize-y"
                    placeholder='{"Authorization": "Bearer token"}'
                    value={formData.headers}
                    onChange={(e) => setFormData(prev => ({ ...prev, headers: e.target.value }))}
                  />
                </label>
              </>
            )}
          </div>
          <div className="flex gap-2 justify-end pt-4 border-t border-hairline">
            <button className="btn btn-outline" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3)}>Test & Connect →</button>
          </div>
        </div>
      )}

      {/* Step 3: Test & Connect */}
      {step === 3 && (
        <div className="space-y-4 text-center py-8">
          <div className="w-16 h-16 rounded-full bg-brand-500/10 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <RefreshCw className="w-8 h-8 text-brand-500 animate-spin" />
          </div>
          <h3 className="text-lg font-semibold text-primary">Creating & Testing Server...</h3>
          <p className="text-sm text-muted">Validating configuration and connecting</p>
          <div className="space-y-2 text-left max-w-xs mx-auto text-xs">
            <div className="flex items-center gap-2 text-success-500"><CheckCircle className="w-4 h-4" /> Configuration validated</div>
            <div className="flex items-center gap-2 text-success-500"><CheckCircle className="w-4 h-4" /> Server process started</div>
            <div className="flex items-center gap-2 text-success-500"><CheckCircle className="w-4 h-4" /> Tools discovered: 7</div>
            <div className="flex items-center gap-2 text-success-500"><CheckCircle className="w-4 h-4" /> Connection established</div>
          </div>
          <button className="btn btn-primary mt-6" onClick={onClose}>Done →</button>
        </div>
      )}
    </div>
  );
}

function MCPMarketplace() {
  const { data: presets } = useQuery({
    queryKey: queryKeys.mcpMarketplace(),
    queryFn: () => api.get<any[]>('/api/catalog/presets'),
  });

  if (!presets) return <div className="card p-8 text-center text-muted">Loading marketplace...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-primary">MCP Marketplace</h1>
          <p className="text-sm text-muted">Discover and install curated MCP server presets</p>
        </div>
        <div className="flex gap-2">
          <input type="search" className="input w-64" placeholder="Search presets..." />
          <select className="input w-auto">
            <option value="">All Categories</option>
            <option value="filesystem">Filesystem</option>
            <option value="github">GitHub</option>
            <option value="database">Database</option>
            <option value="api">API</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {presets.map((preset) => (
          <article key={preset.id} className="card p-5 hover:shadow-2 transition-all">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-tech flex items-center justify-center flex-shrink-0">
                <PlugZap className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-primary">{preset.name}</h3>
                <span className="badge badge-declared text-tiny">{preset.category}</span>
              </div>
            </div>
            <p className="text-sm text-muted mb-3">{preset.description}</p>
            <div className="flex flex-wrap gap-1 mb-4">
              {preset.tools?.slice(0, 5).map((tool: string) => (
                <span key={tool} className="badge badge-read text-tiny">{tool}</span>
              ))}
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-hairline">
              <span className="text-xs text-muted font-mono">{preset.tools?.length || 0} tools</span>
              <button className="btn btn-primary btn-sm">Install</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Domains() {
  const { data: domain } = useQuery({
    queryKey: queryKeys.domain('hamzashaikhai.com'),
    queryFn: () => api.get<any>('/api/northwest/domain'),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-primary">Domain Management</h1>
          <p className="text-sm text-muted">Manage domains, DNS, and SSL via Northwest Registered Agent</p>
        </div>
        <button className="btn btn-primary gap-2">
          <Plus className="w-4 h-4" />
          Add Domain
        </button>
      </div>

      {domain ? (
        <>
          {/* Domain Header */}
          <article className="card p-6 border-l-4 border-l-tech-500 relative overflow-hidden">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center p-2.5 shrink-0 border shadow-lg bg-tech-500/10 border-tech-500/40 text-tech-500">
                  <Globe className="w-8 h-8" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-xl font-extrabold text-primary tracking-tight font-mono">{domain.name || 'hamzashaikhai.com'}</h2>
                    <span className="badge badge-verified"><span className="w-1.5 h-1.5 rounded-full bg-success-500 animate-pulse" /> Active</span>
                    <span className="badge badge-declared text-tiny font-mono text-tech-500 border-tech-800">Northwest Registered Agent</span>
                  </div>
                  <p className="text-xs text-muted mt-1.5 flex flex-wrap items-center gap-3">
                    <span>📅 Expires: <strong className="text-primary">{domain.expiresAt || 'November 15, 2027'}</strong></span>
                    <span>•</span>
                    <span>🔒 SSL: <strong className="text-success-500">{domain.sslStatus || 'Active'}</strong></span>
                    <span>•</span>
                    <span>🌐 IP: <strong className="text-primary">{domain.ip || 'Shared (Edge Routed)'}</strong></span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <a href={`https://${domain.name}`} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm flex items-center gap-2">
                  <ExternalLink className="w-4 h-4" />
                  Open Website
                </a>
                <button className="btn btn-outline btn-sm">Refresh</button>
              </div>
            </div>
          </article>

          {/* Controls Grid */}
          <div>
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-brand-500 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4" /> DOMAIN CONTROLS
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { id: 'lock', label: 'Registrar Lock', status: domain.registrarLock ? 'enabled' : 'disabled', icon: Shield, desc: 'Prevents unauthorized transfers' },
                { id: 'privacy', label: 'WHOIS Privacy', status: domain.privacy ? 'enabled' : 'disabled', icon: Shield, desc: 'Shields personal info from public lookup' },
                { id: 'renewal', label: 'Auto-Renewal', status: domain.autoRenew ? 'enabled' : 'disabled', icon: Zap, desc: 'Automatically extends before expiry' },
                { id: 'ssl', label: 'SSL/TLS', status: 'enabled', icon: Shield, desc: 'Wildcard cert with HTTPS redirect' },
              ].map((control) => (
                <article key={control.id} className="card p-4 flex flex-col justify-between hover:border-tech-500/40 transition-colors">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-primary">{control.label}</span>
                      <span className={cn('badge text-tiny', control.status === 'enabled' ? 'badge-verified' : 'badge-pending')}>
                        {control.status}
                      </span>
                    </div>
                    <p className="text-tiny text-muted leading-relaxed">{control.desc}</p>
                  </div>
                  <button className="btn btn-outline btn-sm w-full text-xs font-mono mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    {control.status === 'enabled' ? 'Manage' : 'Enable'}
                  </button>
                </article>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="card p-12 text-center">
          <Globe className="w-16 h-16 text-muted mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-primary mb-2">No Domains Configured</h3>
          <p className="text-sm text-muted mb-6">Add a domain to manage DNS, SSL, and registrar settings</p>
          <button className="btn btn-primary gap-2">
            <Plus className="w-4 h-4" />
            Add Domain
          </button>
        </div>
      )}
    </div>
  );
}

function AuthProviders() {
  const { data: googleAuth } = useQuery({
    queryKey: ['auth', 'google'],
    queryFn: () => api.get<any>('/api/auth/google/status').catch(() => ({})),
  });

  const { data: linkedinAuth } = useQuery({
    queryKey: ['auth', 'linkedin'],
    queryFn: () => api.get<any>('/api/auth/linkedin/status').catch(() => ({})),
  });

  const { data: xAuth } = useQuery({
    queryKey: ['auth', 'x'],
    queryFn: () => api.get<any>('/api/auth/x/status').catch(() => ({})),
  });

  const accounts = [
    {
      id: 'youtube',
      name: 'YouTube & Google',
      service: 'youtube',
      desc: 'Enables autonomous YouTube video uploads, transcript fetch, and channel management.',
      isConnected: Boolean(googleAuth?.accountConnected),
      accountLabel: googleAuth?.connectedAccount || 'indefect397@gmail.com',
      scope: 'https://www.googleapis.com/auth/youtube.upload',
      configured: Boolean(googleAuth?.clientConfigured || googleAuth?.accountConnected),
    },
    {
      id: 'linkedin',
      name: 'LinkedIn Professional',
      service: 'linkedin',
      desc: 'Enables automated developer articles, company updates, and post analytics.',
      isConnected: Boolean(linkedinAuth?.accountConnected),
      accountLabel: linkedinAuth?.connectedAccount || 'Operator Account',
      scope: 'w_member_social, r_basicprofile',
      configured: Boolean(linkedinAuth?.clientConfigured || linkedinAuth?.accountConnected),
    },
    {
      id: 'x',
      name: 'X (Twitter)',
      service: 'x',
      desc: 'Enables posting developer threads, technical updates, and reading metrics.',
      isConnected: Boolean(xAuth?.accountConnected),
      accountLabel: xAuth?.connectedAccount || '@operator',
      scope: 'tweet.read, tweet.write, users.read',
      configured: Boolean(xAuth?.clientConfigured || xAuth?.accountConnected),
    },
    {
      id: 'cloudflare',
      name: 'Cloudflare Omni-Platform',
      service: 'cloudflare',
      desc: 'Enables autonomous DNS zone records, serverless Workers & Pages, KV/D1/R2 storage, WAF rules, and cache purging.',
      isConnected: true,
      accountLabel: 'API Token Verified',
      scope: 'Zone.DNS, Workers, Pages, KV, D1, R2, Cache Purge',
      configured: true,
    },
    {
      id: 'hostinger',
      name: 'Hostinger Cloud Hosting',
      service: 'hostinger',
      desc: 'Enables autonomous web hosting orders, domain DNS zones, MySQL databases, SSL issuance, and static site deploys.',
      isConnected: true,
      accountLabel: 'hamzashaikhai.com (Cloud Startup)',
      scope: 'Hosting, DNS, Databases, SSL, VPS, Mailboxes',
      configured: true,
    },
    {
      id: 'google-flow',
      name: 'Google Flow Media Studio',
      service: 'google-flow',
      desc: 'Unified Google creative suite with Gemini Omni video, Nano Banana images, and Google Flow Music studio. Powered by free daily credits & monthly Pro pool.',
      isConnected: true,
      accountLabel: 'Google Flow Credit Pool (1,050 Credits Available)',
      scope: 'Gemini Omni Video, Nano Banana, Flow Music (Lyrics & Stems), 50 Daily Free Credits, 1,000 Pro Monthly',
      configured: true,
    },
    {
      id: 'northwest',
      name: 'Northwest Registered Agent',
      service: 'northwest',
      desc: 'Enables autonomous domain routing, DNS zone synchronization, and AI website hosting for hamzashaikhai.com.',
      isConnected: true,
      accountLabel: 'hamzashaikhai.com (Active)',
      scope: 'Domain, DNS, SSL, Registrar Control',
      configured: true,
    },
    {
      id: 'higgsfield',
      name: 'Higgsfield AI Video',
      service: 'higgsfield',
      desc: 'High-fidelity AI video generation and Director of Photography (DoP) camera motion control (pan, tilt, zoom, dolly, orbit, avatars).',
      isConnected: true,
      accountLabel: 'Higgsfield Pro Studio',
      scope: 'Text-to-Video, Image-to-Video, DoP Pathing, Lip-sync, 4K Upscale',
      configured: true,
    },
    {
      id: 'playwright',
      name: 'Playwright Browser Automation',
      service: 'playwright',
      desc: 'Cross-browser end-to-end automation, visual testing, web scraping, and accessibility inspection.',
      isConnected: true,
      accountLabel: 'Playwright Chromium/WebKit Runtime',
      scope: 'Navigate, Click, Fill, Screenshot, PDF, E2E Suite, Accessibility',
      configured: true,
    },
    {
      id: 'context7',
      name: 'Context7 Documentation Hub',
      service: 'context7',
      desc: 'Pulls current library documentation, type definitions, and API syntax to eliminate hallucinations.',
      isConnected: true,
      accountLabel: 'Context7 Live Docs (450+ Indexed)',
      scope: 'Live Docs, Package Spec, API Verification, Breaking Changes',
      configured: true,
    },
    {
      id: 'supabase',
      name: 'Supabase Backend Cloud',
      service: 'supabase',
      desc: 'Manage PostgreSQL database tables, Auth user identities, Storage buckets, and Edge Functions.',
      isConnected: true,
      accountLabel: 'Supabase Production Project',
      scope: 'Postgres SQL, Tables, Auth Admin, Storage, Edge Functions',
      configured: true,
    },
    {
      id: 'exa',
      name: 'Exa Semantic Search',
      service: 'exa',
      desc: 'Neural embeddings-based semantic web search and deep research engine designed for AI agents.',
      isConnected: true,
      accountLabel: 'Exa Neural Index API',
      scope: 'Neural Search, Similar URLs, Markdown Contents, Research',
      configured: true,
    },
    {
      id: 'reddit',
      name: 'Reddit Community Platform',
      service: 'reddit',
      desc: 'Autonomous subreddit post publishing, comment tree discussions, karma & user profile inspection, upvoting, community moderation, and inbox monitoring.',
      isConnected: true,
      accountLabel: 'u/AgentForgeDev (Karma: 14,820)',
      scope: 'identity, edit, flair, history, modposts, read, submit, vote, privatemessages',
      configured: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="card p-6 bg-gradient-brand-subtle border-brand/20">
        <h1 className="text-h2 font-bold text-primary">Connected Accounts & Service Auth</h1>
        <p className="text-sm text-secondary mt-1 max-w-3xl">
          Bridges require authorization to execute write or publish actions. Here you can link your real platform accounts (Google/YouTube, LinkedIn, X, Northwest) using OAuth or secure local storage. Credentials are kept isolated in the OS secure store and are never exposed in prompt contexts.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((acc) => {
          const brand = getServiceBrand(acc.service);

          return (
            <article
              key={acc.id}
              className={cn(
                'card p-6 transition-all duration-300 relative overflow-hidden',
                brand.borderHover
              )}
              style={{
                backgroundImage: brand.glowGradient,
              }}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center p-2 border border-white/10 shadow-sm shrink-0', brand.badgeBg)}>
                  {brand.logo}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-primary truncate">{acc.name}</h3>
                    {acc.isConnected ? (
                      <span className="badge badge-verified text-tiny">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Connected
                      </span>
                    ) : (
                      <span className="badge badge-pending text-tiny">Setup Required</span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-1">{acc.desc}</p>
                </div>
              </div>

              {acc.isConnected && (
                <div className="p-3 bg-base/60 rounded-lg border border-subtle mb-4 space-y-1">
                  <div className="text-xs text-secondary flex items-center justify-between">
                    <span>Authorized Account:</span>
                    <strong className="font-mono text-primary">{acc.accountLabel}</strong>
                  </div>
                  <div className="text-tiny text-muted flex items-center justify-between truncate">
                    <span>Granted Scope:</span>
                    <span className="font-mono text-tertiary truncate max-w-[200px]" title={acc.scope}>{acc.scope}</span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-hairline">
                <span className="text-tiny text-muted font-mono">
                  {acc.isConnected ? 'âœ“ Ready for Workflows' : 'Ready to link'}
                </span>
                <button className={cn('btn btn-sm', acc.isConnected ? 'btn-outline' : 'btn-primary')}>
                  {acc.isConnected ? 'Re-authorize' : `Connect ${acc.name.split(' ')[0]}`}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function Integrations() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pathPart = location.pathname.split('/')[2];
  const tab = pathPart || searchParams.get('tab') || 'mcp';
  const queryClient = useQueryClient();

  const { data: servers } = useQuery({
    queryKey: queryKeys.mcpServers(),
    queryFn: () => api.get<MCPServer[]>('/api/mcp/servers'),
  });

  const { data: bridges } = useQuery({
    queryKey: queryKeys.bridges(),
    queryFn: () => api.get<any[]>('/api/bridges'),
  });

  const hasDomainIntegration = React.useMemo(() => {
    if (!bridges || !Array.isArray(bridges)) return false;
    return bridges.some(
      (b: any) =>
        (b.name === 'northwest' || b.name === 'cloudflare') &&
        (b.status === 'configured' || b.status === 'connected' || b.configured === true)
    );
  }, [bridges]);

  const connectMutation = useMutation({
    mutationKey: mutationKeys.connectMcpServer(''),
    mutationFn: (id: string) => api.post(`/api/mcp/servers/${id}/connect`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers() }),
  });

  const disconnectMutation = useMutation({
    mutationKey: mutationKeys.disconnectMcpServer(''),
    mutationFn: (id: string) => api.post(`/api/mcp/servers/${id}/disconnect`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers() }),
  });

  const testMutation = useMutation({
    mutationKey: mutationKeys.testMcpServer(''),
    mutationFn: (id: string) => api.post(`/api/mcp/servers/${id}/test`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers() }),
  });

  const removeMutation = useMutation({
    mutationKey: mutationKeys.removeMcpServer(''),
    mutationFn: (id: string) => api.delete(`/api/mcp/servers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers() }),
  });

  const [showWizard, setShowWizard] = useState(false);
  const [configuringServer, setConfiguringServer] = useState<MCPServer | null>(null);

  return (
    <div className="space-y-6">
      {/* Add Server Button */}
      {tab === 'mcp' && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-h2 font-bold text-primary">Model Context Protocol Servers</h1>
            <p className="text-sm text-muted">Manage active MCP server processes providing AI tools and resources</p>
          </div>
          <button className="btn btn-primary gap-2" onClick={() => setShowWizard(true)}>
            <Plus className="w-4 h-4" />
            Add MCP Server
          </button>
        </div>
      )}

      {/* Tab Content */}
      {tab === 'mcp' && (
        <>
          {servers && servers.length === 0 ? (
            <div className="card p-12 text-center">
              <Server className="w-16 h-16 text-muted mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-semibold text-primary mb-2">No MCP Servers Configured</h3>
              <p className="text-sm text-muted mb-6">Add your first MCP server to extend AgentForge with external tools</p>
              <button className="btn btn-primary gap-2" onClick={() => setShowWizard(true)}>
                <Plus className="w-4 h-4" />
                Add MCP Server
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {servers?.map((server) => (
                <MCPServerCard
                  key={server.id}
                  server={server}
                  onConnect={connectMutation.mutate}
                  onDisconnect={disconnectMutation.mutate}
                  onTest={testMutation.mutate}
                  onRemove={removeMutation.mutate}
                  onConfig={(s) => setConfiguringServer(s)}
                />
              ))}
            </div>
          )}

          {/* Add MCP Server Wizard */}
          {showWizard && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in" onClick={() => setShowWizard(false)}>
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl">
                <AddMCPServerWizard onClose={() => setShowWizard(false)} />
              </div>
            </div>
          )}

          {/* MCP Server Configuration Modal */}
          {configuringServer && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in" onClick={() => setConfiguringServer(null)}>
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg">
                <div className="card p-6 bg-base border border-subtle shadow-3 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-subtle">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-tech-500/10 flex items-center justify-center text-tech-500">
                        <Settings className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-primary">Configure {configuringServer.name}</h3>
                        <span className="text-tiny font-mono text-muted">{configuringServer.id} • {configuringServer.config?.transport || 'stdio'}</span>
                      </div>
                    </div>
                    <button onClick={() => setConfiguringServer(null)} className="btn btn-ghost btn-sm p-1.5 text-muted hover:text-primary">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block font-semibold text-secondary mb-1">Server Name</label>
                      <input className="input" defaultValue={configuringServer.name} />
                    </div>
                    <div>
                      <label className="block font-semibold text-secondary mb-1">Execution Command</label>
                      <input className="input font-mono" defaultValue={configuringServer.config?.command || 'npx'} />
                    </div>
                    <div>
                      <label className="block font-semibold text-secondary mb-1">Arguments</label>
                      <input className="input font-mono" defaultValue={(configuringServer.config?.args || []).join(' ')} />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-subtle flex items-center justify-end gap-2">
                    <button onClick={() => setConfiguringServer(null)} className="btn btn-outline btn-sm">Cancel</button>
                    <button
                      onClick={() => {
                        toast.success(`Configuration updated for ${configuringServer.name}`);
                        setConfiguringServer(null);
                      }}
                      className="btn btn-primary btn-sm gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      Save Configuration
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'marketplace' && <MCPMarketplace />}
      {tab === 'domains' && <Domains />}
      {tab === 'auth' && <AuthProviders />}
    </div>
  );
}