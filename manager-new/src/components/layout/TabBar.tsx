import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/store';
import { api, queryKeys } from '@/lib/query';

const SUB_TABS: Record<string, { path: string; label: string; icon?: React.ReactNode }[]> = {
  '/catalog': [
    { path: '/catalog', label: 'All Integrations' },
    { path: '/catalog/bridges', label: 'Bridges' },
    { path: '/catalog/truth', label: 'Truth Matrix' },
    { path: '/catalog/presets', label: 'MCP Presets' },
  ],
  '/integrations': [
    { path: '/integrations/mcp', label: 'MCP Servers' },
    { path: '/integrations/auth', label: 'Connected Accounts' },
    { path: '/integrations/domains', label: 'Domains & DNS' },
  ],
  '/workflows': [
    { path: '/workflows/studio', label: 'Studio' },
    { path: '/workflows/runs', label: 'Runs' },
    { path: '/workflows/approvals', label: 'Approvals' },
    { path: '/workflows/reconcile', label: 'Reconciliation' },
  ],
  '/security': [
    { path: '/security/vault', label: 'Credential Vault' },
    { path: '/security/audit', label: 'Audit Log' },
  ],
  '/settings': [
    { path: '/settings/general', label: 'General' },
    { path: '/settings/builder', label: 'Bridge Builder' },
    { path: '/settings/diagnostics', label: 'Diagnostics' },
  ],
};

const getParentTab = (pathname: string): string => {
  const root = '/' + pathname.split('/')[1];
  if (SUB_TABS[root]) return root;
  for (const parent of Object.keys(SUB_TABS)) {
    if (pathname.startsWith(parent)) return parent;
  }
  return pathname;
};

export function TabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeSubTab, setActiveSubTab } = useUIStore();

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

  const parentTab = getParentTab(location.pathname);
  const rawTabs = SUB_TABS[parentTab];

  if (!rawTabs || rawTabs.length <= 1) return null;

  const tabs = rawTabs.filter(t => {
    if (t.path === '/integrations/domains' && !hasDomainIntegration) return false;
    return true;
  });

  return (
    <div className="mb-6 border-b border-subtle" role="tablist" aria-label="Section navigation">
      <nav className="flex gap-1 overflow-x-auto px-2 pb-1" style={{ scrollbarWidth: 'thin' }}>
        {tabs.map((tab) => {
          const isActive = tab.path === '/catalog'
            ? location.pathname === '/catalog'
            : location.pathname === tab.path || location.pathname.startsWith(tab.path + '/');

          return (
            <button
              key={tab.path}
              onClick={() => {
                setActiveSubTab(parentTab, tab.path);
                navigate(tab.path);
              }}
              className={cn(
                'btn btn-sm transition-all duration-200 ease-spring',
                'whitespace-nowrap px-4 py-2',
                'relative',
                isActive
                  ? 'text-primary bg-gradient-brand-subtle border-brand'
                  : 'text-secondary hover:text-primary hover:bg-hover border-transparent'
              )}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.path}`}
            >
              {tab.label}
              {isActive && (
                <span
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand-500"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}