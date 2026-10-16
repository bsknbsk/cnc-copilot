import React, { useState, useEffect } from 'react';
import { RedGlassPanel } from './RedGlassPanel.js';
import { extractFileNameFromStack } from './ErrorBoundary.js';

interface GlobalErrorState {
  errorMessage: string;
  fileName: string;
  stack?: string | null;
  componentStack?: string | null;
}

/**
 * Filter out expected non-fatal platform/runtime warnings as mandated by environment constraints:
 * "- HMR: Disabled. Ignore WebSocket errors."
 */
export function isIgnorableError(message?: string | null, stack?: string | null): boolean {
  if (!message && !stack) return false;
  const str = `${message || ''} ${stack || ''}`.toLowerCase();

  return (
    str.includes('websocket') ||
    str.includes('transport was disconnected') ||
    str.includes('failed to construct \'websocket\'') ||
    str.includes('closing handshake') ||
    str.includes('resizeobserver') ||
    str.includes('the client is offline') ||
    str.includes('bundleddevclient') ||
    str.includes('@vite/client') ||
    str.includes('vite:ws')
  );
}

export function GlobalErrorHandler({ children }: { children: React.ReactNode }) {
  const [globalError, setGlobalError] = useState<GlobalErrorState | null>(null);

  useEffect(() => {
    const handleGlobalError = (
      message: string | Event,
      source?: string,
      lineno?: number,
      colno?: number,
      error?: Error
    ) => {
      const errStr = typeof message === 'string' ? message : (message as any)?.message || 'Script Error';
      const stack = error?.stack || null;

      // Ignore WebSocket / HMR / ResizeObserver harmless messages per environment guidelines
      if (isIgnorableError(errStr, stack)) {
        return;
      }

      const file =
        source && lineno
          ? `${source}:${lineno}${colno ? `:${colno}` : ''}`
          : extractFileNameFromStack(error);

      console.error('[Application Script Error]:', { message: errStr, file, stack });

      setGlobalError({
        errorMessage: errStr,
        fileName: file,
        stack,
        componentStack: null,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      let errStr = 'Unhandled Asynchronous Promise Rejection';
      let stack: string | null = null;
      let file = 'Async Promise Pipeline';

      if (reason instanceof Error) {
        errStr = reason.message || errStr;
        stack = reason.stack || null;
        file = extractFileNameFromStack(reason);
      } else if (typeof reason === 'string') {
        errStr = reason;
      } else if (reason && typeof reason === 'object') {
        try {
          errStr = JSON.stringify(reason);
        } catch {
          errStr = String(reason);
        }
      }

      // Ignore WebSocket / HMR / ResizeObserver harmless messages per environment guidelines
      if (isIgnorableError(errStr, stack)) {
        return;
      }

      console.error('[Application Unhandled Rejection]:', { message: errStr, file, stack });

      setGlobalError({
        errorMessage: errStr,
        fileName: file,
        stack,
        componentStack: null,
      });
    };

    window.onerror = handleGlobalError;
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      if (window.onerror === handleGlobalError) {
        window.onerror = null;
      }
    };
  }, []);

  if (globalError) {
    return (
      <div className="min-h-screen bg-surface-container-lowest text-on-surface flex items-center justify-center p-4">
        <RedGlassPanel
          errorMessage={globalError.errorMessage}
          fileName={globalError.fileName}
          stack={globalError.stack}
          componentStack={globalError.componentStack}
          route="Global / Unhandled"
          onReset={() => setGlobalError(null)}
          onNavigateHome={() => {
            setGlobalError(null);
            window.location.href = '/';
          }}
        />
      </div>
    );
  }

  return <>{children}</>;
}
