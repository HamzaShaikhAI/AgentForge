import React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="card p-12 text-center">
      <Icon className="w-16 h-16 text-muted mx-auto mb-4 opacity-50" />
      <h3 className="text-lg font-semibold text-primary mb-2">{title}</h3>
      <p className="text-sm text-muted mb-6 max-w-md mx-auto">{description}</p>
      {action && <div className="flex justify-center gap-3">{action}</div>}
    </div>
  );
}