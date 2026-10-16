import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RedGlassPanel } from './RedGlassPanel.js';

interface Props {
  children: ReactNode;
  route?: string;
  onNavigateHome?: () => void;
  fallback?: (error: Error, errorInfo: ErrorInfo, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  fileName: string | null;
}

export function extractFileNameFromStack(
  error?: Error | null,
  componentStack?: string | null
): string {
  if (!error && !componentStack) return 'Unknown Source File';
  if ((error as any)?.fileName) return (error as any).fileName;

  const stack = error?.stack || '';

  // Look for application source paths: e.g. /src/components/... or /server/...
  const srcMatch = stack.match(
    /(?:https?:\/\/[^\s/]+)?(\/(?:src|server|engine|context|lib)[\w\-./]+\.(?:tsx|ts|jsx|js)(?::\d+:\d+)?)/i
  );
  if (srcMatch && srcMatch[1]) {
    return srcMatch[1];
  }

  // Look for any http(s) URL with line and column numbers
  const urlMatch = stack.match(
    /((?:https?:\/\/[^\s()]+|\bfile:\/\/[^\s()]+)[\w\-./]+\.(?:tsx|ts|jsx|js)(?::\d+:\d+)?)/i
  );
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  // Component stack trace fallback:
  if (componentStack) {
    const compMatch = componentStack.match(
      /((?:https?:\/\/[^\s()]+|\bfile:\/\/[^\s()]+|\/(?:src)[\w\-./]+)(?::\d+:\d+)?)/i
    );
    if (compMatch && compMatch[1]) {
      return compMatch[1];
    }
    // Extract first component name if no file URL found
    const nameMatch = componentStack.match(/^\s*at\s+([A-Za-z0-9_]+)/m);
    if (nameMatch && nameMatch[1]) {
      return `<${nameMatch[1]} /> component`;
    }
  }

  return 'Client Runtime (Vite)';
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      fileName: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const fileName = extractFileNameFromStack(error, errorInfo.componentStack);
    console.error('[ErrorBoundary caught exception]:', {
      route: this.props.route,
      fileName,
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    });

    this.setState({
      errorInfo,
      fileName,
    });
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      fileName: null,
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback && this.state.errorInfo) {
        return this.props.fallback(this.state.error, this.state.errorInfo, this.resetError);
      }

      return (
        <RedGlassPanel
          errorMessage={this.state.error.message || String(this.state.error)}
          componentStack={this.state.errorInfo?.componentStack || null}
          fileName={this.state.fileName}
          stack={this.state.error.stack || null}
          route={this.props.route || null}
          onReset={this.resetError}
          onNavigateHome={this.props.onNavigateHome}
        />
      );
    }

    return this.props.children;
  }
}
