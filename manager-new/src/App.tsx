import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from '@/components/layout/Shell';
import { Dashboard } from '@/pages/Dashboard';
import { Catalog } from '@/pages/Catalog';
import { Integrations } from '@/pages/Integrations';
import { Workflows } from '@/pages/Workflows';
import { Security } from '@/pages/Security';
import { Settings } from '@/pages/Settings';
import { Tutorials } from '@/pages/Tutorials';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useUIStore } from '@/lib/store';

function App() {
  const { theme, setResolvedTheme } = useUIStore();

  useEffect(() => {
    // Apply theme to document
    const root = document.documentElement;
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const applySystemTheme = () => {
        const resolved = mq.matches ? 'dark' : 'light';
        root.setAttribute('data-theme', resolved);
        setResolvedTheme(resolved);
      };
      applySystemTheme();
      mq.addEventListener('change', applySystemTheme);
      return () => mq.removeEventListener('change', applySystemTheme);
    } else {
      root.setAttribute('data-theme', theme);
      setResolvedTheme(theme as 'light' | 'dark');
    }
  }, [theme, setResolvedTheme]);

  return (
    <ErrorBoundary fallbackTitle="AgentForge Application Error">
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            {/* Redirect root to dashboard */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            {/* Primary Routes */}
            <Route path="/dashboard" element={<ErrorBoundary fallbackTitle="Dashboard Error"><Dashboard /></ErrorBoundary>} />
            <Route path="/catalog/*" element={<ErrorBoundary fallbackTitle="Catalog Error"><Catalog /></ErrorBoundary>} />
            <Route path="/integrations/*" element={<ErrorBoundary fallbackTitle="Integrations Error"><Integrations /></ErrorBoundary>} />
            <Route path="/workflows/*" element={<ErrorBoundary fallbackTitle="Workflows Error"><Workflows /></ErrorBoundary>} />
            <Route path="/security/*" element={<ErrorBoundary fallbackTitle="Security Error"><Security /></ErrorBoundary>} />
            <Route path="/settings/*" element={<ErrorBoundary fallbackTitle="Settings Error"><Settings /></ErrorBoundary>} />
            <Route path="/tutorials/*" element={<ErrorBoundary fallbackTitle="Tutorials Error"><Tutorials /></ErrorBoundary>} />

          {/* Legacy redirects */}
          <Route path="/overview" element={<Navigate to="/dashboard" replace />} />
          <Route path="/truth-matrix" element={<Navigate to="/catalog/truth" replace />} />
          <Route path="/bridges" element={<Navigate to="/catalog/bridges" replace />} />
          <Route path="/mcp-marketplace" element={<Navigate to="/integrations/marketplace" replace />} />
          <Route path="/mcp-servers" element={<Navigate to="/integrations/mcp" replace />} />
          <Route path="/domain-commander" element={<Navigate to="/integrations/domains" replace />} />
          <Route path="/workflow-studio" element={<Navigate to="/workflows/studio" replace />} />
          <Route path="/approvals" element={<Navigate to="/workflows/approvals" replace />} />
          <Route path="/reconciliation" element={<Navigate to="/workflows/reconcile" replace />} />
          <Route path="/vault" element={<Navigate to="/security/vault" replace />} />
          <Route path="/builder" element={<Navigate to="/settings/builder" replace />} />

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </ErrorBoundary>
  );
}

function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <h1 className="text-display font-bold text-primary mb-2">404</h1>
        <p className="text-lg text-muted mb-6">Page not found</p>
        <a href="/dashboard" className="btn btn-primary">Go to Dashboard</a>
      </div>
    </div>
  );
}

export default App;