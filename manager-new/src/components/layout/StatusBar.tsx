import React from 'react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/store';

export function StatusBar() {
  const { resolvedTheme, density } = useUIStore();

  return (
    <footer className="h-10 border-t bg-overlay/60 backdrop-blur-xl flex items-center justify-between px-6 text-xs text-muted shrink-0">
      <div className="flex items-center gap-4">
        <span className="font-mono">AgentForge v2.0.0</span>
        <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-tiny font-mono bg-hover border border-hairline">
          {resolvedTheme}
        </span>
        <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-tiny font-mono bg-hover border border-hairline">
          {density}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-success-500" aria-hidden="true" />
          <span>API Connected</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-tech-500" aria-hidden="true" />
          <span>Local-First</span>
        </span>
      </div>
    </footer>
  );
}