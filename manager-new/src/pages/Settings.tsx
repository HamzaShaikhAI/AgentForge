import React, { useState } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Settings as SettingsIcon,
  Code2,
  Terminal,
  Download,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Zap,
  Database,
  Globe,
  Key,
  Shield,
  Play,
  Pause,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  FileText,
  ExternalLink,
  Server,
  GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys, mutationKeys } from '@/lib/query';
import { formatRelativeTime } from '@/lib/utils';

interface StagedBridge {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'validated' | 'testing' | 'tested' | 'failed' | 'registered';
  createdAt: string;
  capabilities: { name: string; description: string; permissionLevel: string }[];
  testResults?: { passed: boolean; coverage: number; errors: string[] };
}

interface DiagnosticsInfo {
  nodeVersion: string;
  platform: string;
  bridgesPath: string;
  loopbackServer: string;
  gitInstalled: boolean;
  dpapiAvailable: boolean;
  mcpServersConnected: number;
  workflowsRunning: number;
}

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: 'text-muted', dot: 'bg-muted' },
  validated: { label: 'Validated', color: 'text-tech-500', dot: 'bg-tech-500' },
  testing: { label: 'Testing...', color: 'text-warm-500', dot: 'bg-warm-500 animate-pulse' },
  tested: { label: 'Tested', color: 'text-success-500', dot: 'bg-success-500' },
  failed: { label: 'Failed', color: 'text-brand-500', dot: 'bg-brand-500' },
  registered: { label: 'Registered', color: 'text-success-500', dot: 'bg-success-500' },
};

function GeneralSettings() {
  const [config, setConfig] = useState({
    theme: 'dark',
    density: 'comfortable',
    autoRefresh: true,
    refreshInterval: 30,
    notifications: true,
    telemetry: false,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h2 font-bold text-primary">General Settings</h1>
        <p className="text-sm text-muted">Configure AgentForge preferences and behavior</p>
      </div>

      <article className="card p-6 space-y-6">
        {/* Theme */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-primary">Theme</h3>
            <p className="text-sm text-muted">Choose your preferred color scheme</p>
          </div>
          <select className="input w-auto min-w-[140px]" value={config.theme} onChange={(e) => setConfig(prev => ({ ...prev, theme: e.target.value }))}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </div>

        <div className="border-t border-hairline" />

        {/* Density */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-primary">View Density</h3>
            <p className="text-sm text-muted">Control information density in tables and grids</p>
          </div>
          <select className="input w-auto min-w-[140px]" value={config.density} onChange={(e) => setConfig(prev => ({ ...prev, density: e.target.value }))}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
            <option value="data">Data Table</option>
          </select>
        </div>

        <div className="border-t border-hairline" />

        {/* Auto Refresh */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-primary">Auto-Refresh</h3>
            <p className="text-sm text-muted">Automatically refresh data at intervals</p>
          </div>
          <button
            onClick={() => setConfig(prev => ({ ...prev, autoRefresh: !prev.autoRefresh }))}
            className={cn('btn btn-sm px-3 gap-2', config.autoRefresh ? 'btn-primary' : 'btn-outline')}
          >
            {config.autoRefresh ? <Check className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {config.autoRefresh ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        <div className="border-t border-hairline" />

        {/* Refresh Interval */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-primary">Refresh Interval</h3>
            <p className="text-sm text-muted">How often to fetch new data</p>
          </div>
          <select className="input w-auto min-w-[140px]" value={config.refreshInterval} onChange={(e) => setConfig(prev => ({ ...prev, refreshInterval: Number(e.target.value) }))}>
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>1 minute</option>
            <option value={300}>5 minutes</option>
          </select>
        </div>

        <div className="border-t border-hairline" />

        {/* Notifications */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-primary">Notifications</h3>
            <p className="text-sm text-muted">Show toast notifications for actions</p>
          </div>
          <button
            onClick={() => setConfig(prev => ({ ...prev, notifications: !prev.notifications }))}
            className={cn('btn btn-sm px-3 gap-2', config.notifications ? 'btn-primary' : 'btn-outline')}
          >
            {config.notifications ? <Check className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {config.notifications ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        <div className="border-t border-hairline" />

        {/* Telemetry */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-primary">Anonymous Telemetry</h3>
            <p className="text-sm text-muted">Help improve AgentForge with usage analytics</p>
          </div>
          <button
            onClick={() => setConfig(prev => ({ ...prev, telemetry: !prev.telemetry }))}
            className={cn('btn btn-sm px-3 gap-2', config.telemetry ? 'btn-primary' : 'btn-outline')}
          >
            {config.telemetry ? <Check className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {config.telemetry ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </article>
    </div>
  );
}

function BridgeBuilder() {
  const [prompt, setPrompt] = useState('');
  const [analysis, setAnalysis] = useState<any>(null);
  const [generating, setGenerating] = useState(false);

  const { data: stagedBridges } = useQuery({
    queryKey: queryKeys.stagedBridges(),
    queryFn: () => api.get<StagedBridge[]>('/api/builder/staged'),
  });

  const analyzeMutation = useMutation({
    mutationKey: mutationKeys.analyzeBuilder(),
    mutationFn: (text: string) => api.post('/api/builder/analyze', { prompt: text }),
    onSuccess: (data) => setAnalysis(data),
  });

  const generateMutation = useMutation({
    mutationKey: mutationKeys.generateBridge(),
    mutationFn: (bridgeId: string) => api.post(`/api/builder/generate`, { bridgeId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.stagedBridges() }),
  });

  const validateMutation = useMutation({
    mutationKey: mutationKeys.validateStagedBridge(''),
    mutationFn: (id: string) => api.post(`/api/builder/staged/${id}/validate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.stagedBridges() }),
  });

  const testMutation = useMutation({
    mutationKey: mutationKeys.testStagedBridge(''),
    mutationFn: (id: string) => api.post(`/api/builder/staged/${id}/test`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.stagedBridges() }),
  });

  const registerMutation = useMutation({
    mutationKey: mutationKeys.registerBridge(''),
    mutationFn: (id: string) => api.post(`/api/builder/staged/${id}/register`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.stagedBridges() }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/builder/staged/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.stagedBridges() }),
  });

  const queryClient = useQueryClient();

  const handleAnalyze = () => {
    if (!prompt.trim()) return;
    analyzeMutation.mutate(prompt);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h2 font-bold text-primary">Agentic Bridge Builder</h1>
        <p className="text-sm text-muted">Generate custom integrations using AI-powered code generation</p>
      </div>

      {/* Prompt Input */}
      <article className="card p-5">
        <label className="block mb-3">
          <span className="block text-xs font-medium text-secondary mb-1">What bridge do you want to build?</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="input min-h-[80px] resize-y"
            placeholder="e.g. Create a local SQLite database bridge with read and query actions..."
          />
        </label>
        <div className="flex gap-2">
          <button
            onClick={handleAnalyze}
            disabled={!prompt.trim() || analyzeMutation.isPending}
            className="btn btn-primary gap-2"
          >
            <Zap className="w-4 h-4" />
            {analyzeMutation.isPending ? 'Analyzing...' : 'Analyze Intent'}
          </button>
          <button className="btn btn-outline gap-2">
            <FileText className="w-4 h-4" />
            Browse Examples
          </button>
        </div>
      </article>

      {/* Analysis Results */}
      {analysis && (
        <article className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-primary">Analysis Results</h3>
            <button
              onClick={() => generateMutation.mutate(analysis.id)}
              disabled={generateMutation.isPending}
              className="btn btn-primary btn-sm gap-2"
            >
              <Code2 className="w-4 h-4" />
              {generateMutation.isPending ? 'Generating...' : 'Generate Bridge'}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Detected Capabilities</h4>
              <div className="flex flex-wrap gap-1">
                {analysis.capabilities?.map((cap: any) => (
                  <span key={cap.name} className="badge badge-read text-tiny">{cap.name}</span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Suggested Permissions</h4>
              <div className="flex flex-wrap gap-1">
                {analysis.permissions?.map((perm: string) => (
                  <span key={perm} className={cn('badge text-tiny', perm === 'read' ? 'badge-read' : perm === 'local-write' ? 'badge-local-write' : 'badge-external-write')}>{perm}</span>
                ))}
              </div>
            </div>
          </div>
        </article>
      )}

      {/* Staged Bridges */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h3 font-semibold text-primary">Staged Bridges</h2>
          <button className="btn btn-outline btn-sm gap-2">
            <Plus className="w-4 h-4" />
            New Bridge
          </button>
        </div>

        {stagedBridges && stagedBridges.length > 0 ? (
          <div className="space-y-4">
            {stagedBridges.map((bridge) => {
              const status = STATUS_CONFIG[bridge.status];
              return (
                <article key={bridge.id} className="card p-5 hover:shadow-2 transition-all">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-semibold text-primary">{bridge.name}</h3>
                        <span className={cn('badge text-tiny', `badge-${status.dot.replace('bg-', '').replace('animate-pulse', '')}`)}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-sm text-muted">{bridge.description}</p>
                    </div>
                    <span className="text-xs text-muted whitespace-nowrap">{formatRelativeTime(bridge.createdAt)}</span>
                  </div>

                  {bridge.capabilities.length > 0 && (
                    <div className="mb-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Capabilities</h4>
                      <div className="flex flex-wrap gap-1">
                        {bridge.capabilities.map((cap) => (
                          <span key={cap.name} className="badge badge-read text-tiny" title={cap.description}>{cap.name}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {bridge.testResults && (
                    <div className="mb-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Test Results</h4>
                      <div className="flex items-center gap-4">
                        <span className={cn('flex items-center gap-1.5', bridge.testResults.passed ? 'text-success-500' : 'text-brand-500')}>
                          {bridge.testResults.passed ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                          {bridge.testResults.passed ? 'All Tests Passed' : `${bridge.testResults.errors.length} Errors`}
                        </span>
                        <span className="text-sm text-secondary">Coverage: {bridge.testResults.coverage}%</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-3 border-t border-hairline">
                    <button
                      onClick={() => validateMutation.mutate(bridge.id)}
                      disabled={validateMutation.isPending}
                      className="btn btn-outline btn-sm"
                    >
                      Validate
                    </button>
                    <button
                      onClick={() => testMutation.mutate(bridge.id)}
                      disabled={testMutation.isPending}
                      className="btn btn-outline btn-sm"
                    >
                      Run Tests
                    </button>
                    <button
                      onClick={() => registerMutation.mutate(bridge.id)}
                      disabled={registerMutation.isPending || bridge.status !== 'tested'}
                      className="btn btn-primary btn-sm ml-auto"
                    >
                      Register Bridge
                    </button>
                    <button
                      onClick={() => removeMutation.mutate(bridge.id)}
                      disabled={removeMutation.isPending}
                      className="btn btn-ghost btn-sm p-1.5 text-brand-500 hover:bg-brand-500/10"
                      aria-label="Delete bridge"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="card p-12 text-center">
            <Code2 className="w-16 h-16 text-muted mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-semibold text-primary mb-2">No Staged Bridges</h3>
            <p className="text-sm text-muted mb-6">Use the builder above to create your first custom integration</p>
            <button className="btn btn-primary gap-2">
              <Plus className="w-4 h-4" />
              Create Bridge
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Diagnostics() {
  const { data: diag } = useQuery({
    queryKey: queryKeys.diagnostics(),
    queryFn: () => api.get<DiagnosticsInfo>('/api/status'),
  });

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  if (!diag) return <div className="card p-8 text-center text-muted">Loading diagnostics...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h2 font-bold text-primary">Diagnostics & Health</h1>
        <p className="text-sm text-muted">System status and configuration details</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Info */}
        <article className="card p-5">
          <h3 className="text-lg font-semibold text-primary mb-4">System Information</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Node.js Version</span>
              <span className="font-mono text-primary">{diag.nodeVersion}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Platform</span>
              <span className="font-mono text-primary">{diag.platform}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Bridges Path</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-primary truncate max-w-[200px]">{diag.bridgesPath}</span>
                <button onClick={() => copyToClipboard(diag.bridgesPath)} className="btn btn-ghost btn-sm p-1" aria-label="Copy path">
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Loopback Server</span>
              <div className="flex items-center gap-2">
                <a href={diag.loopbackServer} target="_blank" rel="noopener noreferrer" className="font-mono text-tech-500 hover:underline">
                  {diag.loopbackServer}
                </a>
                <ExternalLink className="w-3 h-3 text-muted" />
              </div>
            </div>
          </div>
        </article>

        {/* Service Status */}
        <article className="card p-5">
          <h3 className="text-lg font-semibold text-primary mb-4">Service Status</h3>
          <div className="space-y-3">
            {[
              { label: 'Git Installed', ok: diag.gitInstalled, icon: Terminal },
              { label: 'DPAPI Available', ok: diag.dpapiAvailable, icon: Shield },
              { label: 'MCP Servers Connected', count: diag.mcpServersConnected, icon: Server },
              { label: 'Workflows Running', count: diag.workflowsRunning, icon: GitBranch },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center justify-between p-3 rounded-xl bg-hover border border-hairline">
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5 text-secondary" />
                    <span className="text-sm text-primary">{item.label}</span>
                  </div>
                  {item.count !== undefined ? (
                    <span className="badge badge-publish text-tiny">{item.count}</span>
                  ) : (
                    <span className={cn('badge text-tiny', item.ok ? 'badge-verified' : 'badge-blocked')}>
                      {item.ok ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </article>
      </div>

      {/* MCP Config Snippet */}
      <article className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-primary">Antigravity MCP Configuration</h3>
          <button onClick={() => copyToClipboard(JSON.stringify({ mcpServers: {} }, null, 2))} className="btn btn-outline btn-sm gap-2">
            <Copy className="w-4 h-4" />
            Copy Config
          </button>
        </div>
        <pre className="p-4 rounded-xl bg-bg-input border border-subtle overflow-x-auto text-xs font-mono text-secondary">
{JSON.stringify({
  "mcpServers": {
    "agentforge": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "env": {
        "AGENTFORGE_HOME": "~/.agentforge"
      }
    }
  }
}, null, 2)}
        </pre>
      </article>
    </div>
  );
}

export function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pathPart = location.pathname.split('/')[2];
  const tab = pathPart || searchParams.get('tab') || 'general';

  const tabs = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'builder', label: 'Bridge Builder', icon: Code2 },
    { id: 'diagnostics', label: 'Diagnostics', icon: Terminal },
  ];

  return (
    <div className="space-y-6">
      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(`/settings/${t.id}`)}
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

      {tab === 'general' && <GeneralSettings />}
      {tab === 'builder' && <BridgeBuilder />}
      {tab === 'diagnostics' && <Diagnostics />}
    </div>
  );
}