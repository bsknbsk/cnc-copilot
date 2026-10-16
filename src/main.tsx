import { createRoot } from 'react-dom/client';
import App from './App.js';
import './index.css';

// Emergency pre-mount error handler to prevent blank screen in fatal bootstrap scenarios
if (typeof window !== 'undefined') {
  const isIgnorable = (msg: string, stack?: string) => {
    const str = `${msg || ''} ${stack || ''}`.toLowerCase();
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
  };

  const mountEmergencyPanel = (msg: string, source?: string, stack?: string) => {
    if (isIgnorable(msg, stack)) return;

    const root = document.getElementById('root');
    if (root && (!root.hasChildNodes() || root.innerHTML.trim() === '')) {
      const displayFile = (source || 'Client Bootstrap').replace(/^https?:\/\/[^/]+/, '');
      root.innerHTML = `
        <div style="min-height: 100vh; background-color: #0a0e13; color: #fee2e2; display: flex; align-items: center; justify-content: center; padding: 1.5rem; font-family: ui-sans-serif, system-ui, sans-serif;">
          <div style="max-width: 56rem; width: 100%; border-radius: 1rem; background: rgba(69, 10, 10, 0.75); backdrop-filter: blur(16px); border: 1px solid rgba(239, 68, 68, 0.5); padding: 2rem; box-shadow: 0 12px 40px rgba(239, 68, 68, 0.35);">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem; border-bottom: 1px solid rgba(239,68,68,0.25); padding-bottom: 1rem;">
              <span style="font-size: 1.5rem;">⚠️</span>
              <div>
                <h2 style="font-size: 1.25rem; font-weight: 700; color: #fecaca; margin: 0;">Application Runtime Exception</h2>
                <div style="font-size: 0.75rem; color: #fca5a5; font-family: monospace; margin-top: 0.25rem;">Source File: ${displayFile}</div>
              </div>
            </div>
            <div style="margin-bottom: 1rem; font-family: monospace; font-size: 0.8125rem; background: rgba(0,0,0,0.5); padding: 1rem; border-radius: 0.5rem; border: 1px solid rgba(239,68,68,0.3); word-break: break-all;">
              ${msg}
            </div>
            ${stack ? `<pre style="font-family: monospace; font-size: 0.7rem; color: #fca5a5; background: rgba(0,0,0,0.6); padding: 1rem; border-radius: 0.5rem; max-height: 200px; overflow: auto; white-space: pre-wrap;">${stack}</pre>` : ''}
            <div style="margin-top: 1.5rem;">
              <button onclick="window.location.href='/'" style="background: rgba(239,68,68,0.3); border: 1px solid rgba(239,68,68,0.6); color: white; padding: 0.5rem 1rem; border-radius: 0.5rem; font-family: monospace; font-size: 0.75rem; cursor: pointer;">Return to Dashboard</button>
            </div>
          </div>
        </div>
      `;
    }
  };

  window.addEventListener('error', (event) => {
    if (isIgnorable(event.message || '', event.error?.stack)) return;
    mountEmergencyPanel(event.message || 'Script execution error', event.filename, event.error?.stack);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    if (isIgnorable(msg, stack)) return;
    mountEmergencyPanel(
      msg,
      reason instanceof Error && (reason as any).fileName ? (reason as any).fileName : 'Async Pipeline',
      stack
    );
  });
}

createRoot(document.getElementById('root')!).render(<App />);
