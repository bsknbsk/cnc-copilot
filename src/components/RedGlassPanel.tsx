import React from 'react';

export interface RedGlassPanelProps {
  errorMessage: string;
  componentStack?: string | null;
  fileName?: string | null;
  stack?: string | null;
  route?: string | null;
  onReset?: () => void;
  onNavigateHome?: () => void;
}

export function RedGlassPanel({
  errorMessage,
  componentStack,
  fileName,
  stack,
  route,
  onReset,
  onNavigateHome,
}: RedGlassPanelProps) {
  const [showFullStack, setShowFullStack] = React.useState(false);

  // Extract a clean file name if full URL or path is present
  const displayFileName = React.useMemo(() => {
    if (!fileName) return 'Unknown Source File';
    try {
      const clean = fileName.replace(/^https?:\/\/[^/]+/, '');
      return clean.startsWith('/') ? clean.slice(1) : clean;
    } catch {
      return fileName;
    }
  }, [fileName]);

  const handleReload = () => {
    window.location.reload();
  };

  const handleGoHome = () => {
    if (onNavigateHome) {
      onNavigateHome();
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8">
      <div className="relative rounded-2xl bg-red-950/70 backdrop-blur-xl border border-red-500/50 shadow-[0_12px_40px_rgba(239,68,68,0.35)] overflow-hidden text-red-100 font-sans">
        {/* Top Decorative Hazard Accent Stripe */}
        <div className="h-1.5 w-full bg-gradient-to-r from-red-600 via-amber-500 to-red-600 animate-pulse" />

        <div className="p-6 sm:p-8 flex flex-col gap-6">
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-red-500/20">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-900/60 border border-red-400/40 flex items-center justify-center text-red-400 shadow-inner">
                <span className="material-symbols-outlined text-[28px]">crisis_alert</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-headline-md text-lg font-bold text-red-100 tracking-tight">
                    Route Runtime Exception
                  </h2>
                  <span className="px-2 py-0.5 rounded bg-red-900/80 border border-red-400/50 text-[10px] font-mono font-bold uppercase tracking-wider text-red-300">
                    Fault Intercepted
                  </span>
                </div>
                <p className="text-xs text-red-300/80 mt-0.5">
                  {route ? `Caught while rendering route /${route}` : 'Caught by global exception boundary'}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              {onReset && (
                <button
                  type="button"
                  onClick={onReset}
                  className="h-9 px-4 rounded-lg bg-red-900/60 hover:bg-red-800/80 border border-red-500/40 text-xs font-mono font-semibold text-red-100 transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">refresh</span>
                  Retry Route
                </button>
              )}
              <button
                type="button"
                onClick={handleGoHome}
                className="h-9 px-4 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-400/40 text-xs font-mono font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">home</span>
                Dashboard
              </button>
              <button
                type="button"
                onClick={handleReload}
                className="h-9 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-xs font-mono text-tertiary transition-colors cursor-pointer flex items-center gap-1"
                title="Hard Reload"
              >
                <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              </button>
            </div>
          </div>

          {/* Source File Banner */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 p-3.5 rounded-xl bg-black/40 border border-red-500/30 flex items-start gap-3">
              <span className="material-symbols-outlined text-red-400 text-[20px] mt-0.5">description</span>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-mono uppercase tracking-wider text-red-400/80 font-bold">
                  Originating Source File
                </span>
                <span className="text-xs font-mono font-bold text-red-200 truncate mt-0.5" title={displayFileName}>
                  {displayFileName}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-black/40 border border-red-500/30 flex items-start gap-3">
              <span className="material-symbols-outlined text-red-400 text-[20px] mt-0.5">shield</span>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-mono uppercase tracking-wider text-red-400/80 font-bold">
                  Status
                </span>
                <span className="text-xs font-mono font-semibold text-red-200 mt-0.5">
                  Execution Halted (Zero Blank)
                </span>
              </div>
            </div>
          </div>

          {/* Error Message Box */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-red-300/80 font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              Error Message
            </span>
            <div className="p-4 rounded-xl bg-red-950/80 border border-red-500/40 font-mono text-xs text-red-100 break-words leading-relaxed select-text shadow-inner">
              {errorMessage || 'Unknown application error'}
            </div>
          </div>

          {/* Component Stack & Call Stack */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-red-300/80 font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                Component & Call Stack
              </span>
              {(stack || componentStack) && (
                <button
                  type="button"
                  onClick={() => setShowFullStack((prev) => !prev)}
                  className="text-[11px] font-mono text-red-300 hover:text-white underline cursor-pointer"
                >
                  {showFullStack ? 'Collapse Stack' : 'Expand Full Stack'}
                </button>
              )}
            </div>

            <div
              className={`p-4 rounded-xl bg-black/60 border border-red-500/30 font-mono text-[11px] text-red-200/90 overflow-x-auto whitespace-pre leading-relaxed select-text shadow-inner ${
                showFullStack ? 'max-h-[400px]' : 'max-h-[160px]'
              }`}
            >
              {componentStack ? (
                <>
                  <div className="text-red-400 font-bold mb-1">// React Component Hierarchy:</div>
                  <div>{componentStack.trim()}</div>
                </>
              ) : null}

              {stack ? (
                <>
                  <div className="text-red-400 font-bold mt-2 mb-1">// Native JavaScript Stack:</div>
                  <div>{stack.trim()}</div>
                </>
              ) : null}

              {!componentStack && !stack && (
                <div className="text-red-400/60 italic">No stack trace available.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
