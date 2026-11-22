import React, { useState } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  GitBranch,
  Terminal,
  AlertTriangle,
  Zap,
  Play,
  Pause,
  XCircle,
  Eye,
  RotateCcw,
  Download,
  Filter,
  Search,
  ChevronDown,
  MoreHorizontal,
  Clock,
  CheckCircle,
  XCircle as XCircleIcon,
  AlertTriangle as AlertTriangleIcon,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys, mutationKeys } from '@/lib/query';
import { formatRelativeTime, formatDuration } from '@/lib/utils';
import { toast } from 'sonner';

interface Workflow {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  steps: WorkflowStep[];
}

interface WorkflowStep {
  id: string;
  name: string;
  integration: string;
  action: string;
  description?: string;
}

interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused_for_approval' | 'needs_reconciliation' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  currentStep?: number;
  totalSteps: number;
  error?: string;
  approvalCheckpoint?: ApprovalCheckpoint;
}

interface ApprovalCheckpoint {
  id: string;
  runId: string;
  stepId: string;
  stepName: string;
  workflowName?: string;
  integration: string;
  action: string;
  inputs: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requestedAt: string;
  expiresAt?: string;
}

interface ReconciliationItem {
  id: string;
  runId: string;
  workflowName: string;
  stepName: string;
  integration: string;
  action: string;
  sideEffect: string;
  evidence: ReconciliationEvidence[];
  status: 'pending' | 'confirmed' | 'cancelled' | 'investigating';
  createdAt: string;
}

interface ReconciliationEvidence {
  type: 'api_response' | 'log' | 'screenshot' | 'manual';
  description: string;
  data: unknown;
  timestamp: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { label: 'Pending', color: 'text-muted', dot: 'bg-muted', icon: Clock },
  running: { label: 'Running', color: 'text-tech-500', dot: 'bg-tech-500 animate-pulse', icon: Play },
  completed: { label: 'Completed', color: 'text-success-500', dot: 'bg-success-500', icon: CheckCircle },
  failed: { label: 'Failed', color: 'text-brand-500', dot: 'bg-brand-500', icon: XCircleIcon },
  paused_for_approval: { label: 'Awaiting Approval', color: 'text-warm-500', dot: 'bg-warm-500', icon: AlertTriangleIcon },
  'waiting-approval': { label: 'Awaiting Approval', color: 'text-warm-500', dot: 'bg-warm-500', icon: AlertTriangleIcon },
  needs_reconciliation: { label: 'Needs Reconciliation', color: 'text-brand-500', dot: 'bg-brand-500', icon: Zap },
  cancelled: { label: 'Cancelled', color: 'text-muted', dot: 'bg-muted', icon: XCircleIcon },
  stopped: { label: 'Stopped', color: 'text-brand-400', dot: 'bg-brand-400', icon: XCircleIcon },
};

const DEFAULT_STATUS = { label: 'Recorded', color: 'text-muted', dot: 'bg-muted', icon: Clock };

const RISK_COLORS = {
  low: 'text-success-500 bg-success-500/10 border-success-500/20',
  medium: 'text-warm-500 bg-warm-500/10 border-warm-500/20',
  high: 'text-brand-500 bg-brand-500/10 border-brand-500/20',
  critical: 'text-brand-600 bg-brand-600/10 border-brand-600/20',
};

function WorkflowStudio() {
  const { data: rawWorkflows, isLoading, error } = useQuery({
    queryKey: queryKeys.workflows(),
    queryFn: () => api.get<any>('/api/workflows/predefined'),
  });

  const workflows: Workflow[] = Array.isArray(rawWorkflows)
    ? rawWorkflows
    : (rawWorkflows?.workflows || rawWorkflows?.items || []);

  const queryClient = useQueryClient();

  const runMutation = useMutation({
    mutationKey: mutationKeys.runWorkflow(''),
    mutationFn: (workflowId: string) => api.post(`/api/workflows/runs`, { workflowId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workflowRuns() });
      toast.success('Workflow execution started!');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to start workflow execution');
    },
  });

  if (isLoading) return <div className="card p-8 text-center text-muted animate-pulse">Loading workflows...</div>;
  if (error) return <div className="card p-8 text-center text-brand-500">Failed to load workflows. Please check your manager connection.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-primary">Workflow Studio</h1>
          <p className="text-sm text-muted">Create, browse, and run predefined autonomous pipelines</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(workflows || []).map((workflow) => (
          <article key={workflow.id} className="card p-5 hover:shadow-2 transition-all">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center flex-shrink-0">
                <GitBranch className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-primary truncate">{workflow.name}</h3>
                <span className="badge badge-declared text-tiny">v{workflow.version || '1.0.0'}</span>
              </div>
            </div>
            <p className="text-sm text-muted mb-3 line-clamp-2">{workflow.description}</p>
            <div className="flex flex-wrap gap-1 mb-4">
              {(workflow.tags || []).map((tag) => (
                <span key={tag} className="badge badge-read text-tiny">{tag}</span>
              ))}
              {(!workflow.tags || workflow.tags.length === 0) && (
                <span className="badge badge-read text-tiny">autonomous</span>
              )}
            </div>
            <div className="border-t border-hairline pt-3">
              <div className="text-xs text-muted mb-2">
                {(workflow.steps || []).length} steps • {(workflow.steps || []).map(s => (s as any).bridge || s.integration).filter(Boolean).join(', ')}
              </div>
              <button
                className="btn btn-primary w-full gap-2"
                onClick={() => runMutation.mutate(workflow.id)}
                disabled={runMutation.isPending}
              >
                <Play className="w-4 h-4" />
                {runMutation.isPending ? 'Starting...' : 'Run Workflow'}
              </button>
            </div>
          </article>
        ))}
      </div>

      {(!workflows || workflows.length === 0) && (
        <div className="card p-12 text-center">
          <GitBranch className="w-16 h-16 text-muted mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-primary mb-2">No Workflows Available</h3>
          <p className="text-sm text-muted mb-6">Create a custom workflow or connect more bridges</p>
        </div>
      )}
    </div>
  );
}

function WorkflowRuns() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    status: searchParams.get('status') || '',
    workflow: searchParams.get('workflow') || '',
    search: searchParams.get('q') || '',
  });

  const { data: rawRuns, isLoading, error } = useQuery({
    queryKey: queryKeys.workflowRuns(filters),
    queryFn: () => api.get<any>('/api/workflows/runs', { params: filters }),
  });

  const runs: any[] = Array.isArray(rawRuns) ? rawRuns : (rawRuns?.runs || rawRuns?.value || []);

  const cancelMutation = useMutation({
    mutationKey: mutationKeys.cancelRun(''),
    mutationFn: (runId: string) => api.post(`/api/workflows/runs/${runId}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workflowRuns(filters) }),
  });

  const approveRunMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/api/workflows/runs/${runId}/approve-all`, { approvedBy: 'Operator (1-Click)' }),
    onSuccess: () => {
      toast.success('1-Click Approved! Executing entire workflow pipeline.');
      queryClient.invalidateQueries({ queryKey: queryKeys.workflowRuns(filters) });
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals() });
    },
    onError: (err: any) => {
      toast.error(`Approval failed: ${err.message || 'Unknown error'}`);
    },
  });

  const [page, setPage] = useState(1);
  const pageSize = 20;

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value); else params.delete(key);
    setSearchParams(params);
  };

  // Extract unique workflows for dynamic filter options
  const uniqueWorkflows = Array.from(new Set(runs.map(r => r.workflowId || r.workflowName).filter(Boolean)));

  const filteredRuns = React.useMemo(() => {
    return runs.filter((run: any) => {
      if (!run) return false;
      if (filters.status && run.status !== filters.status) return false;
      if (filters.workflow && run.workflowId !== filters.workflow && run.workflowName !== filters.workflow) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const id = String(run.id || run.runId || '').toLowerCase();
        const name = String(run.workflowName || run.workflowId || '').toLowerCase();
        const err = String(run.error || '').toLowerCase();
        if (!id.includes(q) && !name.includes(q) && !err.includes(q)) return false;
      }
      return true;
    });
  }, [runs, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / pageSize));
  const paginatedRuns = filteredRuns.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-primary">Workflow Runs</h1>
          <p className="text-sm text-muted">Monitor and manage workflow executions ({runs.length} recorded)</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-outline btn-sm gap-2"
            onClick={() => {
              const blob = new Blob([JSON.stringify(runs, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `agentforge-runs-${Date.now()}.json`;
              a.click();
            }}
          >
            <Download className="w-4 h-4" />
            Export Runs
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="search"
            placeholder="Search runs by ID, workflow, or error..."
            value={filters.search}
            onChange={(e) => handleFilterChange('q', e.target.value)}
            className="input pl-10"
            aria-label="Search runs"
          />
        </div>
        <select
          value={filters.status}
          onChange={(e) => handleFilterChange('status', e.target.value)}
          className="input w-auto min-w-[160px]"
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="paused_for_approval">Awaiting Approval</option>
          <option value="needs_reconciliation">Needs Reconciliation</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
          <option value="stopped">Stopped</option>
        </select>
        <select
          value={filters.workflow}
          onChange={(e) => handleFilterChange('workflow', e.target.value)}
          className="input w-auto min-w-[180px]"
          aria-label="Filter by workflow"
        >
          <option value="">All Workflows</option>
          {uniqueWorkflows.map((wf) => (
            <option key={wf} value={wf}>{wf}</option>
          ))}
        </select>
      </div>

      {/* Error state */}
      {error && (
        <div className="card p-6 text-center text-brand-500 border-brand/20 bg-brand-500/5">
          <p className="font-semibold mb-1">Failed to load workflow runs</p>
          <p className="text-xs text-muted">{(error as any)?.message || 'Make sure the AgentForge server is running on port 9470.'}</p>
        </div>
      )}

      {/* Runs Table */}
      {isLoading ? (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-hover border-b border-subtle">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Workflow</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Started</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Progress</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-hairline animate-pulse">
                  <td className="px-4 py-4"><div className="h-4 w-32 bg-hover rounded" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-24 bg-hover rounded" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-28 bg-hover rounded" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-20 bg-hover rounded" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-24 bg-hover rounded" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-16 bg-hover rounded" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full" role="table">
            <thead className="bg-hover border-b border-subtle">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Workflow</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Started</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted">Progress</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {paginatedRuns.map((run: any) => {
                if (!run) return null;
                const status = (STATUS_CONFIG as Record<string, any>)[run.status] || DEFAULT_STATUS;
                const StatusIcon = status?.icon || Clock;
                const steps = Array.isArray(run.steps) ? run.steps : [];
                const totalSteps = steps.length || run.totalSteps || 1;
                const completedSteps = steps.filter((s: any) => s?.status === 'completed').length || run.currentStep || 0;
                const progress = Math.min(100, Math.max(0, Math.round((completedSteps / totalSteps) * 100)));
                const workflowDisplayName = run.workflowName || run.workflowId || 'Workflow Run';
                const runKey = String(run.id || run.runId || Math.random());
                const runShortId = runKey.slice(0, 10);
                const durationMs = run.duration || (run.completedAt && run.startedAt ? Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) : undefined);

                return (
                  <tr key={runKey} className="hover:bg-hover transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-primary">{workflowDisplayName}</span>
                        <span className="text-xs text-muted font-mono">#{runShortId}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('flex items-center gap-1.5 font-medium text-xs', status?.color || 'text-muted')}>
                        <StatusIcon className={cn('w-4 h-4', status?.dot && status.dot.includes('animate') && 'animate-pulse')} />
                        {status?.label || 'Recorded'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-secondary">{run.startedAt ? formatRelativeTime(run.startedAt) : '—'}</td>
                    <td className="px-4 py-3">
                      {durationMs ? (
                        <span className="font-mono text-sm text-secondary">{formatDuration(durationMs)}</span>
                      ) : run.status === 'running' ? (
                        <span className="flex items-center gap-1 text-tech-500 text-xs">
                          <Play className="w-3 h-3 animate-spin" />
                          Running...
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-32 h-2 bg-hover rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-brand rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted">{completedSteps}/{totalSteps} steps</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {(run.status === 'paused_for_approval' || run.status === 'waiting-approval') && (
                          <button
                            onClick={() => approveRunMutation.mutate(runKey)}
                            disabled={approveRunMutation.isPending}
                            className="btn btn-primary btn-sm px-2.5 py-1 text-xs gap-1 bg-warm-600 hover:bg-warm-700 text-white font-medium shadow-sm transition-all"
                            aria-label="1-Click Approve"
                            title="1-Click Approve and auto-execute remaining pipeline"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            1-Click Approve
                          </button>
                        )}
                        <button className="btn btn-outline btn-sm px-2" aria-label="View details">
                          <Eye className="w-4 h-4" />
                        </button>
                        {run.status === 'running' && (
                          <button
                            onClick={() => cancelMutation.mutate(runKey)}
                            disabled={cancelMutation.isPending}
                            className="btn btn-outline btn-sm px-2 text-warm-500 border-warm-500/30 hover:bg-warm-500/10"
                            aria-label="Cancel run"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        {run.status === 'failed' && (
                          <button className="btn btn-outline btn-sm px-2" aria-label="Retry">
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredRuns.length === 0 && (
            <div className="p-8 text-center text-muted">No workflow runs found</div>
          )}

          {/* Pagination Footer */}
          {filteredRuns.length > pageSize && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-subtle bg-base/50 text-xs text-muted">
              <span>
                Showing <strong className="text-primary">{(page - 1) * pageSize + 1}</strong> to{' '}
                <strong className="text-primary">{Math.min(page * pageSize, filteredRuns.length)}</strong> of{' '}
                <strong className="text-primary">{filteredRuns.length}</strong> runs
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-outline btn-sm px-2.5"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className="font-mono text-secondary">
                  Page {page} of {totalPages}
                </span>
                <button
                  className="btn btn-outline btn-sm px-2.5"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Approvals() {
  const queryClient = useQueryClient();
  const { data: rawApprovals, isLoading } = useQuery({
    queryKey: queryKeys.approvals(),
    queryFn: () => api.get<any>('/api/approvals'),
  });

  const approvals: ApprovalCheckpoint[] = Array.isArray(rawApprovals)
    ? rawApprovals
    : (rawApprovals?.approvals || []);

  const approveMutation = useMutation({
    mutationKey: mutationKeys.approveCheckpoint(''),
    mutationFn: (runId: string) => api.post(`/api/workflows/runs/${runId}/approve`, { approvedBy: 'Operator' }),
    onSuccess: () => {
      toast.success('Step checkpoint approved!');
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals() });
      queryClient.invalidateQueries({ queryKey: queryKeys.workflowRuns() });
    },
  });

  const approveAllRunMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/api/workflows/runs/${runId}/approve-all`, { approvedBy: 'Operator (1-Click Run)' }),
    onSuccess: () => {
      toast.success('Entire run approved & auto-executing!');
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals() });
      queryClient.invalidateQueries({ queryKey: queryKeys.workflowRuns() });
    },
  });

  const approveAllGlobalMutation = useMutation({
    mutationFn: () => api.post('/api/workflows/approvals/approve-all', { approvedBy: 'Operator (1-Click Global)' }),
    onSuccess: (data: any) => {
      toast.success(`1-Click Approved ${data?.approvedCount || 'all'} pending runs!`);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals() });
      queryClient.invalidateQueries({ queryKey: queryKeys.workflowRuns() });
    },
  });

  const rejectMutation = useMutation({
    mutationKey: mutationKeys.rejectCheckpoint(''),
    mutationFn: (runId: string) => api.post(`/api/workflows/runs/${runId}/reject`, { rejectedBy: 'Operator', reason: 'Rejected from UI' }),
    onSuccess: () => {
      toast.error('Checkpoint rejected.');
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals() });
      queryClient.invalidateQueries({ queryKey: queryKeys.workflowRuns() });
    },
  });

  const columns = [
    { id: 'pending', label: 'Pending', color: 'border-warm-500' },
    { id: 'reviewing', label: 'Reviewing', color: 'border-tech-500' },
    { id: 'approved', label: 'Approved', color: 'border-success-500' },
    { id: 'rejected', label: 'Rejected', color: 'border-brand-500' },
  ];

  const approvalsByStatus = {
    pending: approvals.filter(a => !a.expiresAt || new Date(a.expiresAt) > new Date()),
    reviewing: [],
    approved: [],
    rejected: [],
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-primary">Approvals Queue</h1>
          <p className="text-sm text-muted">Human-in-the-loop governance with 1-click execution for sensitive operations</p>
        </div>
        {approvalsByStatus.pending.length > 0 && (
          <button
            onClick={() => approveAllGlobalMutation.mutate()}
            disabled={approveAllGlobalMutation.isPending}
            className="btn btn-primary btn-sm gap-1.5 bg-warm-600 hover:bg-warm-700 text-white font-medium shadow-sm transition-all"
            title="Approve all currently pending checkpoints in 1 click"
          >
            <CheckCircle className="w-4 h-4" />
            1-Click Approve All ({approvalsByStatus.pending.length})
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[calc(100vh-300px)]">
        {columns.map((col) => {
          const items = approvalsByStatus[col.id as keyof typeof approvalsByStatus] || [];
          return (
            <div key={col.id} className="card flex flex-col" style={{ borderLeft: `4px solid var(--color-${col.color.replace('border-', '')})` }}>
              <div className="p-4 border-b border-subtle flex items-center justify-between">
                <h3 className="font-semibold text-primary">{col.label}</h3>
                <span className="badge badge-publish text-tiny">{items.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {items.length === 0 ? (
                  <div className="text-center text-muted py-8">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No items</p>
                  </div>
                ) : (
                  items.map((approval) => (
                    <article key={approval.id} className="card p-4 hover:shadow-2 transition-all">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <h4 className="font-medium text-primary text-sm">{approval.stepName}</h4>
                          <p className="text-xs text-muted">{approval.workflowName} • {approval.integration}</p>
                        </div>
                        <span className={cn('badge text-tiny', RISK_COLORS[approval.riskLevel])}>
                          {approval.riskLevel.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-xs text-muted mb-3 font-mono">
                        {JSON.stringify(approval.inputs).slice(0, 80)}...
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => approveAllRunMutation.mutate(approval.runId)}
                          disabled={approveAllRunMutation.isPending}
                          className="btn btn-primary btn-sm flex-1 gap-1 bg-warm-600 hover:bg-warm-700 text-white font-medium text-xs px-2"
                          title="Approve this step and auto-approve all remaining steps in this run"
                        >
                          <Zap className="w-3 h-3" />
                          1-Click Run
                        </button>
                        <button
                          onClick={() => approveMutation.mutate(approval.runId)}
                          disabled={approveMutation.isPending}
                          className="btn btn-outline btn-sm px-2 gap-1"
                          title="Approve this single step"
                        >
                          <CheckCircle className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(approval.runId)}
                          disabled={rejectMutation.isPending}
                          className="btn btn-outline btn-sm px-2 text-brand-500 border-brand-500/30 hover:bg-brand-500/10"
                          title="Reject step"
                        >
                          <XCircleIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Reconciliation() {
  const queryClient = useQueryClient();
  const { data: rawItems, isLoading } = useQuery({
    queryKey: queryKeys.reconciliation(),
    queryFn: () => api.get<any>('/api/workflows/runs?status=needs_reconciliation'),
  });

  const items: ReconciliationItem[] = Array.isArray(rawItems)
    ? rawItems
    : (rawItems?.runs || rawItems?.value || []);

  const reconcileMutation = useMutation({
    mutationKey: mutationKeys.reconcileRun(''),
    mutationFn: (runId: string) => api.post(`/api/workflows/runs/${runId}/reconcile`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reconciliation() }),
  });

  if (isLoading) return <div className="card p-8 text-center text-muted">Loading reconciliation items...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h2 font-bold text-primary">Reconciliation Queue</h1>
        <p className="text-sm text-muted">Resolve ambiguous side-effects from network timeouts</p>
      </div>

      {items.length === 0 ? (
        <div className="card p-12 text-center">
          <Zap className="w-16 h-16 text-muted mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-primary mb-2">All Clear</h3>
          <p className="text-sm text-muted">No ambiguous side-effects need resolution</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article key={item.id} className="card p-5 hover:shadow-2 transition-all">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold text-primary">{item.workflowName}</h3>
                    <span className="badge badge-destructive text-tiny">NEEDS RECONCILIATION</span>
                  </div>
                  <p className="text-sm text-muted">{item.stepName} • {item.integration} • {item.action}</p>
                </div>
                <span className="text-xs text-muted whitespace-nowrap">{formatRelativeTime(item.createdAt)}</span>
              </div>

              <div className="border-t border-subtle pt-3 mb-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Side Effect</h4>
                <p className="text-sm text-secondary font-mono">{item.sideEffect}</p>
              </div>

              <div className="mb-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Evidence</h4>
                <div className="space-y-1">
                  {item.evidence.map((ev, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted">
                      <span className="w-2 h-2 rounded-full bg-muted" />
                      <span>{ev.description}</span>
                      <span className="badge badge-declared text-tiny">{ev.type}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button className="btn btn-outline btn-sm" aria-label="Investigate">Investigate</button>
                <button
                  onClick={() => reconcileMutation.mutate(item.runId)}
                  disabled={reconcileMutation.isPending}
                  className="btn btn-primary btn-sm gap-1"
                >
                  <CheckCircle className="w-3 h-3" />
                  Confirm Resolved
                </button>
                <button className="btn btn-outline btn-sm text-brand-500 border-brand-500/30 hover:bg-brand-500/10" aria-label="Cancel">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function Workflows() {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Determine active tab from URL pathname (/workflows/studio -> 'studio', /workflows/runs -> 'runs') or ?tab=
  const pathPart = location.pathname.split('/')[2];
  const tab = pathPart || searchParams.get('tab') || 'studio';

  return (
    <div className="space-y-6">
      {tab === 'studio' && <WorkflowStudio />}
      {tab === 'runs' && <WorkflowRuns />}
      {tab === 'approvals' && <Approvals />}
      {tab === 'reconcile' && <Reconciliation />}
    </div>
  );
}