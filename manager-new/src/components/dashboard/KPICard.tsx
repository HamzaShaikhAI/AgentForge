import React from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface KPICardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: 'brand' | 'tech' | 'warm' | 'success';
  path?: string;
}

const COLOR_MAP = {
  brand: { bg: 'bg-gradient-brand', text: 'text-brand-500', border: 'border-brand' },
  tech: { bg: 'bg-gradient-tech', text: 'text-tech-500', border: 'border-tech' },
  warm: { bg: 'bg-gradient-warm', text: 'text-warm-500', border: 'border-warm-500' },
  success: { bg: 'bg-gradient-success', text: 'text-success-500', border: 'border-success-500' },
};

export function KPICard({ label, value, trend, trendValue, icon: Icon, color, path }: KPICardProps) {
  const colors = COLOR_MAP[color];

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-success-500' : trend === 'down' ? 'text-brand-500' : 'text-muted';

  const content = (
    <div className={cn('card p-6 group hover:shadow-2 transition-all duration-300 relative overflow-hidden')}>
      {/* Top accent */}
      <div className={cn('absolute top-0 left-0 right-0 h-0.5', colors.bg)} />

      <div className="flex items-start justify-between">
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', colors.bg)}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        {trend && (
          <span className={cn('flex items-center gap-1 text-xs font-medium', trendColor)}>
            <TrendIcon className="w-4 h-4" />
            {trendValue}
          </span>
        )}
      </div>

      <div className="mt-4">
        <p className="text-tiny font-bold uppercase tracking-wider text-muted">{label}</p>
        <p className="text-3xl font-extrabold text-primary mt-1 font-data">{value}</p>
      </div>
    </div>
  );

  if (path) {
    return (
      <Link to={path} className="block" style={{ textDecoration: 'none' }}>
        {content}
      </Link>
    );
  }

  return content;
}