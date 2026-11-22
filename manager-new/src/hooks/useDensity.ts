import { useUIStore } from '@/lib/store';

export function useDensity() {
  const { density, setDensity } = useUIStore();

  return { density, setDensity };
}