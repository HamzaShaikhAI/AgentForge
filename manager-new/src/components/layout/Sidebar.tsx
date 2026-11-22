import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Database,
  PlugZap,
  GitBranch,
  Shield,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  Zap,
  Server,
  Globe,
  Key,
  Code2,
  Terminal,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/lib/query';

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: number | null;
  condition?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const BASE_NAV_GROUPS: { label: string; items: { path: string; label: string; icon: any; badge: number | null; requiresDomain?: boolean }[] }[] = [
  {
    label: 'CORE',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: null },
      { path: '/catalog', label: 'Catalog', icon: Database, badge: null },
      { path: '/tutorials', label: 'Tutorials & Guides', icon: BookOpen, badge: null },
    ],
  },
  {
    label: 'INTEGRATIONS',
    items: [
      { path: '/integrations/mcp', label: 'MCP Servers', icon: Server, badge: null },
      { path: '/integrations/domains', label: 'Domains & DNS', icon: Globe, badge: null, requiresDomain: true },
      { path: '/integrations/auth', label: 'Connected Accounts', icon: Key, badge: null },
    ],
  },
  {
    label: 'WORKFLOWS',
    items: [
      { path: '/workflows/studio', label: 'Studio', icon: GitBranch, badge: null },
      { path: '/workflows/runs', label: 'Runs', icon: Terminal, badge: null },
      { path: '/workflows/approvals', label: 'Approvals', icon: AlertTriangle, badge: 0 },
      { path: '/workflows/reconcile', label: 'Reconciliation', icon: Zap, badge: 0 },
    ],
  },
  {
    label: 'SECURITY',
    items: [
      { path: '/security/vault', label: 'Credential Vault', icon: Shield, badge: null },
      { path: '/security/audit', label: 'Audit Log', icon: Code2, badge: null },
    ],
  },
  {
    label: 'SETTINGS',
    items: [
      { path: '/settings/general', label: 'General', icon: Settings, badge: null },
      { path: '/settings/builder', label: 'Bridge Builder', icon: Code2, badge: null },
      { path: '/settings/diagnostics', label: 'Diagnostics', icon: Terminal, badge: null },
    ],
  },
];

const SUB_TAB_MAP: Record<string, { path: string; label: string }[]> = {
  '/catalog': [
    { path: '/catalog', label: 'All' },
    { path: '/catalog/bridges', label: 'Bridges' },
    { path: '/catalog/truth', label: 'Truth Matrix' },
    { path: '/catalog/presets', label: 'Presets' },
  ],
  '/integrations/mcp': [
    { path: '/integrations/mcp', label: 'Servers' },
    { path: '/integrations/mcp?view=tools', label: 'Tools' },
  ],
  '/integrations/domains': [
    { path: '/integrations/domains', label: 'Domains' },
    { path: '/integrations/domains/builder', label: 'AI Builder' },
  ],
  '/integrations/auth': [
    { path: '/integrations/auth', label: 'Connected Accounts' },
  ],
  '/workflows/runs': [
    { path: '/workflows/studio', label: 'Studio' },
    { path: '/workflows/runs', label: 'Runs' },
    { path: '/workflows/approvals', label: 'Approvals' },
    { path: '/workflows/reconcile', label: 'Reconcile' },
  ],
  '/security/vault': [
    { path: '/security/vault', label: 'Vault' },
    { path: '/security/audit', label: 'Audit' },
  ],
  '/settings/general': [
    { path: '/settings/general', label: 'General' },
    { path: '/settings/builder', label: 'Builder' },
    { path: '/settings/diagnostics', label: 'Diagnostics' },
  ],
};

export function Sidebar() {
  const location = useLocation();
  const { sidebarCollapsed, toggleSidebar, setSidebarCollapsed, resolvedTheme, activeSubTab, setActiveSubTab } = useUIStore();

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

  const navGroups = React.useMemo(() => {
    return BASE_NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.requiresDomain && !hasDomainIntegration) return false;
        return true;
      }),
    }));
  }, [hasDomainIntegration]);

  const getParentTab = (path: string) => {
    for (const group of navGroups) {
      for (const item of group.items) {
        if (path.startsWith(item.path)) return item.path;
      }
    }
    return path;
  };

  const parentTab = getParentTab(location.pathname);
  const subTabs = SUB_TAB_MAP[parentTab] || [];
  const currentSubTab = activeSubTab[parentTab] || subTabs[0]?.path || parentTab;

  const handleNavClick = (path: string) => {
    setActiveSubTab(parentTab, path);
  };

  return (
    <aside
      className={cn(
        'flex flex-col border-r transition-all duration-300 ease-spring',
        'bg-base border-subtle',
        sidebarCollapsed ? 'w-18' : 'w-72'
      )}
      style={{ height: '100vh', position: 'sticky', top: 0 }}
    >
      {/* Logo / Brand */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-subtle">
        {!sidebarCollapsed && (
          <NavLink to="/dashboard" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-brand flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="font-display font-bold text-lg text-primary">AgentForge</span>
          </NavLink>
        )}
        <button
          onClick={toggleSidebar}
          className={cn(
            'p-2 rounded-lg transition-colors',
            'hover:bg-hover text-secondary',
            sidebarCollapsed ? 'mx-auto' : 'ml-auto'
          )}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1" role="navigation" aria-label="Main navigation">
        {!sidebarCollapsed && (
          <div key="expanded" className="transition-opacity duration-200">
            {navGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                <div className="px-3 py-2 text-tiny font-bold uppercase tracking-wider text-muted">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const isActive = location.pathname.startsWith(item.path);
                  const hasSubTabs = SUB_TAB_MAP[item.path] && SUB_TAB_MAP[item.path].length > 0;
                  const Icon = item.icon;

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => handleNavClick(item.path)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-xl',
                        'transition-all duration-200 ease-spring',
                        'group relative overflow-hidden',
                        isActive
                          ? 'bg-gradient-brand-subtle text-primary border-brand font-medium'
                          : 'text-secondary hover:text-primary hover:bg-hover',
                        sidebarCollapsed && 'justify-center'
                      )}
                      aria-current={isActive ? 'page' : undefined}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      <Icon className={cn('w-5 h-5 flex-shrink-0', isActive && 'text-primary')} aria-hidden="true" />
                      {!sidebarCollapsed && (
                        <>
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.badge !== null && item.badge > 0 && (
                            <span className="badge badge-publish text-tiny">{item.badge}</span>
                          )}
                          {hasSubTabs && isActive && <ChevronDown className="w-4 h-4 text-tertiary transition-transform group-data-[state=open]:rotate-180" />}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {sidebarCollapsed && (
          <div key="collapsed" className="transition-opacity duration-200">
            {navGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                {group.items.map((item) => {
                  const isActive = location.pathname.startsWith(item.path);
                  const Icon = item.icon;

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => handleNavClick(item.path)}
                      className={cn(
                        'flex items-center justify-center px-2 py-2.5 rounded-xl',
                        'transition-all duration-200 ease-spring',
                        'relative',
                        isActive
                          ? 'bg-gradient-brand-subtle text-primary'
                          : 'text-secondary hover:text-primary hover:bg-hover'
                      )}
                      aria-current={isActive ? 'page' : undefined}
                      title={item.label}
                    >
                      <Icon className={cn('w-5 h-5', isActive && 'text-primary')} aria-hidden="true" />
                      {item.badge !== null && item.badge > 0 && (
                        <span className="absolute -top-1 -right-1 badge badge-publish text-[10px]">{item.badge}</span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* Footer - Theme toggle, version */}
      <div className="p-3 border-t border-subtle">
        {!sidebarCollapsed ? (
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const { theme, setTheme } = useUIStore.getState();
                const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
                setTheme(next);
              }}
              className="flex-1 btn btn-outline btn-sm justify-center gap-2"
              aria-label="Toggle theme"
            >
              {resolvedTheme === 'dark' ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                  <span>Dark</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                  <span>Light</span>
                </>
              )}
            </button>
            <span className="text-tiny text-muted font-mono">v2.0.0</span>
          </div>
        ) : (
          <button
            onClick={() => {
              const { theme, setTheme } = useUIStore.getState();
              const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
              setTheme(next);
            }}
            className="w-full btn btn-outline btn-sm justify-center"
            aria-label="Toggle theme"
            title={resolvedTheme === 'dark' ? 'Dark mode' : 'Light mode'}
          >
            {resolvedTheme === 'dark' ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
            )}
          </button>
        )}
      </div>
    </aside>
  );
}