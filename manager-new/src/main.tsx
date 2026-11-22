import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-right"
        theme="system"
        className="toaster-group"
        toastOptions={{
          classNames: {
            toast: 'bg-base border border-subtle text-primary shadow-3 rounded-xl',
            description: 'text-secondary text-sm',
            actionButton: 'btn btn-sm btn-outline',
            closeButton: 'text-muted hover:text-primary',
          },
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>
);