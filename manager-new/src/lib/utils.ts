import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(date: Date | string | number): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length - 1) + '…';
}

export function truncateMiddle(str: string, start: number, end: number): string {
  if (str.length <= start + end) return str;
  return str.slice(0, start) + '…' + str.slice(-end);
}

export function getStatusColor(status: string): 'green' | 'amber' | 'red' | 'blue' | 'gray' {
  switch (status.toLowerCase()) {
    case 'connected':
    case 'completed':
    case 'success':
    case 'verified':
    case 'active':
    case 'healthy':
    case 'enabled':
      return 'green';
    case 'running':
    case 'pending':
    case 'configuring':
    case 'connecting':
    case 'warning':
    case 'needs_auth':
      return 'amber';
    case 'error':
    case 'failed':
    case 'disconnected':
    case 'blocked':
    case 'rejected':
    case 'destroyed':
      return 'red';
    case 'info':
    case 'info':
      return 'blue';
    default:
      return 'gray';
  }
}

export function getPermissionBadgeClass(permission: string): string {
  switch (permission.toLowerCase()) {
    case 'read':
      return 'badge-read';
    case 'local-write':
      return 'badge-local-write';
    case 'external-write':
      return 'badge-external-write';
    case 'publish':
      return 'badge-publish';
    case 'destructive':
      return 'badge-destructive';
    default:
      return 'badge-read';
  }
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function classNames(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}