import React from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Bell, User, Moon, Sun, Monitor, Command } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/store';
import { useModalStore } from '@/lib/store';

const PAGE_TITLES: Record<string, { title: string; subtitle: string; icon: React.ReactNode }> = {
  '/dashboard': { title: 'Dashboard', subtitle: 'System health & quick actions', icon: <Monitor className="w-5 h-5" /> },
  '/catalog': { title: 'Catalog', subtitle: 'All integrations & capabilities', icon: <Database className="w-5 h-5" /> },
  '/catalog/bridges': { title: 'Bridges', subtitle: 'Native bridge integrations', icon: <PlugZap className="w-5 h-5" /> },
  '/catalog/truth': { title: 'Truth Matrix', subtitle: 'Capability verification report', icon: <CheckCircle className="w-5 h-5" /> },
  '/catalog/presets': { title: 'MCP Presets', subtitle: 'Curated server configurations', icon: <Server className="w-5 h-5" /> },
  '/integrations/mcp': { title: 'MCP Servers', subtitle: 'Connected model context servers', icon: <Server className="w-5 h-5" /> },
  '/integrations/marketplace': { title: 'MCP Marketplace', subtitle: 'Discover & install presets', icon: <PlugZap className="w-5 h-5" /> },
  '/integrations/domains': { title: 'Domains', subtitle: 'Domain management & DNS', icon: <Globe className="w-5 h-5" /> },
  '/integrations/domains/builder': { title: 'AI Site Builder', subtitle: 'Deploy websites instantly', icon: <Code2 className="w-5 h-5" /> },
  '/integrations/auth': { title: 'Auth Providers', subtitle: 'OAuth connections & tokens', icon: <Key className="w-5 h-5" /> },
  '/workflows/studio': { title: 'Workflow Studio', subtitle: 'Create & design workflows', icon: <GitBranch className="w-5 h-5" /> },
  '/workflows/runs': { title: 'Workflow Runs', subtitle: 'Execution history & monitoring', icon: <Terminal className="w-5 h-5" /> },
  '/workflows/approvals': { title: 'Approvals', subtitle: 'Human-in-the-loop queue', icon: <AlertTriangle className="w-5 h-5" /> },
  '/workflows/reconcile': { title: 'Reconciliation', subtitle: 'Ambiguous side-effect resolution', icon: <Zap className="w-5 h-5" /> },
  '/security/vault': { title: 'Credential Vault', subtitle: 'Local encrypted token storage', icon: <Shield className="w-5 h-5" /> },
  '/security/audit': { title: 'Audit Log', subtitle: 'Security events & changes', icon: <Code2 className="w-5 h-5" /> },
  '/settings/general': { title: 'Settings', subtitle: 'Configuration & preferences', icon: <Settings className="w-5 h-5" /> },
  '/settings/builder': { title: 'Bridge Builder', subtitle: 'Generate custom integrations', icon: <Code2 className="w-5 h-5" /> },
  '/settings/diagnostics': { title: 'Diagnostics', subtitle: 'System health & debugging', icon: <Terminal className="w-5 h-5" /> },
};

import { Database, PlugZap, CheckCircle, Server, Globe, Code2, GitBranch, Terminal, AlertTriangle, Zap, Shield, Settings, Key } from 'lucide-react';

export function Header() {
  const location = useLocation();
  const { resolvedTheme, setTheme, setGlobalSearchOpen, globalSearchOpen } = useUIStore();
  const { openModal } = useModalStore();

  const pageInfo = PAGE_TITLES[location.pathname] || { title: 'AgentForge', subtitle: '', icon: <Zap className="w-5 h-5" /> };

  const handleSearchOpen = () => {
    setGlobalSearchOpen(true);
    openModal('command-palette');
  };

  return (
    <header className="h-16 border-b bg-overlay/80 backdrop-blur-xl sticky top-0 z-30 flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          {pageInfo.icon}
          <div>
            <h1 className="text-h3 font-bold text-primary">{pageInfo.title}</h1>
            {pageInfo.subtitle && (
              <p className="text-xs text-muted">{pageInfo.subtitle}</p>
            )}
          </div>
        </div>

        {/* Local-first badge */}
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-tiny font-mono font-medium border bg-brand-500/10 text-brand-400 border-brand-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" aria-hidden="true" />
          Local-first
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Global Search */}
        <button
          onClick={handleSearchOpen}
          className={cn(
            'btn btn-outline btn-sm gap-2 px-3 py-1.5',
            'min-w-[200px] sm:min-w-[280px]',
            'justify-start'
          )}
          aria-label="Global search (⌘K)"
        >
          <Search className="w-4 h-4 text-muted" aria-hidden="true" />
          <span className="text-secondary hidden sm:inline">Search...</span>
          <kbd className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-muted bg-hover border border-hairline">
            <Command className="w-3 h-3" />
            <span>K</span>
          </kbd>
        </button>

        {/* Theme Toggle */}
        <button
          onClick={() => {
            const next = resolvedTheme === 'dark' ? 'light' : 'dark';
            setTheme(next);
          }}
          className="btn btn-outline btn-sm p-2"
          aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {resolvedTheme === 'dark' ? (
            <Moon className="w-5 h-5" />
          ) : (
            <Sun className="w-5 h-5" />
          )}
        </button>

        {/* Notifications */}
        <button className="btn btn-outline btn-sm p-2 relative" aria-label="Notifications">
          <Bell className="w-5 h-5" />
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-brand-500" aria-hidden="true" />
        </button>

        {/* User Menu */}
        <div className="relative">
          <button className="btn btn-outline btn-sm gap-2 px-3" aria-label="User menu">
            <div className="w-8 h-8 rounded-full bg-gradient-brand flex items-center justify-center">
              <User className="w-4 h-4 text-white" />
            </div>
            <span className="hidden md:inline text-sm font-medium text-primary">Admin</span>
          </button>
        </div>
      </div>
    </header>
  );
}