import React from 'react';
import { Slot } from '@/lib/slot';
import { cva, type VariantProps } from '@/lib/cva';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 ease-spring whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-gradient-brand text-white border border-white/15 shadow-[0_0_16px_-4px_rgba(244,63,94,0.5),0_2px_4px_rgba(0,0,0,0.1)] hover:shadow-[0_0_24px_-4px_rgba(244,63,94,0.6),0_4px_8px_rgba(0,0,0,0.15)] hover:-translate-y-0.5',
        secondary: 'bg-gradient-tech text-white border border-white/15 shadow-[0_0_16px_-4px_rgba(56,189,248,0.5),0_2px_4px_rgba(0,0,0,0.1)] hover:shadow-[0_0_24px_-4px_rgba(56,189,248,0.6),0_4px_8px_rgba(0,0,0,0.15)] hover:-translate-y-0.5',
        outline: 'bg-bg-input border border-border-default text-text-primary hover:bg-bg-hover hover:border-border-strong',
        ghost: 'bg-transparent border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        destructive: 'bg-gradient-brand text-white hover:shadow-[0_0_24px_-4px_rgba(244,63,94,0.6)]',
      },
      size: {
        sm: 'text-xs px-3 py-1.5 rounded-md gap-1.5',
        default: 'text-sm px-4 py-2 rounded-lg gap-2',
        lg: 'text-base px-6 py-3 rounded-xl gap-2',
        icon: 'p-2 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };