import React from 'react';
import { cn } from '@/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'animate-pulse bg-hover rounded-lg',
          className
        )}
        {...props}
      />
    );
  }
);
Skeleton.displayName = 'Skeleton';

export { Skeleton };