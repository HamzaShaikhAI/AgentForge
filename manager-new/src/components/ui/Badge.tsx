import React from 'react';
import { cva, type VariantProps } from '@/lib/cva';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full font-mono font-medium tracking-wide transition-all duration-150',
  {
    variants: {
      variant: {
        default: 'bg-neutral-800 text-neutral-300 border-neutral-700',
        read: 'bg-tech-500/12 text-tech-400 border-tech-500/25',
        localWrite: 'bg-success-500/12 text-success-400 border-success-500/25',
        externalWrite: 'bg-warm-500/12 text-warm-400 border-warm-500/25',
        publish: 'bg-brand-500/12 text-brand-400 border-brand-500/25 shadow-[0_0_10px_rgba(244,63,94,0.15)]',
        destructive: 'bg-brand-500/14 text-brand-400 border-brand-500/35',
        verified: 'bg-success-500/14 text-success-400 border-success-500/35 shadow-[0_0_12px_rgba(16,185,129,0.12)]',
        pending: 'bg-warm-500/14 text-warm-400 border-warm-500/35',
        blocked: 'bg-brand-500/14 text-brand-400 border-brand-500/35',
        declared: 'bg-neutral-500/12 text-neutral-400 border-neutral-500/22',
      },
      size: {
        sm: 'text-tiny px-2 py-0.5',
        default: 'text-xs px-2.5 py-1',
        lg: 'text-sm px-3 py-1.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}

export { Badge, badgeVariants };