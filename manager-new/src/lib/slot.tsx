import React from 'react';

export const Slot = React.forwardRef<any, any>(({ children, ...props }, ref) => {
  if (React.isValidElement(children)) {
    return React.cloneElement(children as any, {
      ...props,
      ...(children.props as any),
      ref,
    });
  }
  return <span ref={ref} {...props}>{children}</span>;
});
Slot.displayName = 'Slot';
