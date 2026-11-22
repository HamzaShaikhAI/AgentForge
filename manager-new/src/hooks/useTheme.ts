import { useEffect } from 'react';
import { useUIStore } from '@/lib/store';

export function useTheme() {
  const { theme, setTheme, resolvedTheme, setResolvedTheme } = useUIStore();

  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => {
        const resolved = mq.matches ? 'dark' : 'light';
        root.setAttribute('data-theme', resolved);
        setResolvedTheme(resolved);
      };
      apply();
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    } else {
      root.setAttribute('data-theme', theme);
      setResolvedTheme(theme as 'light' | 'dark');
    }
  }, [theme, setResolvedTheme]);

  const toggleTheme = () => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  };

  return { theme, setTheme, resolvedTheme, toggleTheme };
}