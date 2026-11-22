import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';
import { useUIStore } from '@/lib/store';

export function Shell() {
  const { sidebarCollapsed, resolvedTheme } = useUIStore();

  return (
    <div
      className="min-h-screen flex bg-canvas"
      data-theme={resolvedTheme}
    >
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <TabBar />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <Outlet />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}