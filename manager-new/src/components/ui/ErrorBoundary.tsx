import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by AgentForge ErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/dashboard';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="card max-w-lg w-full p-8 text-center border-brand/30 shadow-3 space-y-5 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-brand" />
            <div className="w-14 h-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-500 flex items-center justify-center mx-auto shadow-sm">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-primary">
                {this.props.fallbackTitle || 'Something went wrong'}
              </h2>
              <p className="text-sm text-secondary leading-relaxed">
                An unexpected interface error occurred. AgentForge prevented the screen from crashing.
              </p>
            </div>

            {this.state.error && (
              <div className="text-left bg-hover/80 border border-subtle rounded-xl p-3 text-xs font-mono text-muted max-h-36 overflow-auto">
                <div className="text-brand-500 font-semibold mb-1">{this.state.error.name}: {this.state.error.message}</div>
                {this.state.errorInfo?.componentStack && (
                  <div className="text-[11px] opacity-75 whitespace-pre-wrap">{this.state.errorInfo.componentStack.slice(0, 300)}...</div>
                )}
              </div>
            )}

            <div className="flex items-center justify-center gap-3 pt-2">
              <button onClick={this.handleReset} className="btn btn-primary gap-2">
                <RefreshCw className="w-4 h-4" />
                Reload Page
              </button>
              <button onClick={this.handleGoHome} className="btn btn-outline gap-2">
                <Home className="w-4 h-4" />
                Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
