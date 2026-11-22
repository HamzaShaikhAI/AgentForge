export type VariantProps<T extends (...args: any) => any> = Parameters<T>[0];

export function cva(base: string, config?: any) {
  return (props?: any) => {
    let classes = base;
    const variants = config?.variants || {};
    const defaultVariants = config?.defaultVariants || {};

    const mergedProps = { ...defaultVariants, ...props };

    for (const [key, val] of Object.entries(mergedProps)) {
      if (typeof val === 'string' && variants[key] && variants[key][val]) {
        classes += ' ' + variants[key][val];
      }
    }

    if (props?.className) {
      classes += ' ' + props.className;
    }

    return classes;
  };
}
