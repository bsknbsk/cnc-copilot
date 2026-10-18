import React from 'react';
import { Navigation } from '../Navigation.js';
import { useAuth } from '../../context/AuthContext.js';

interface AppShellProps {
  children: React.ReactNode;
  currentTab: string;
  onNavigate: (tab: string, state?: any) => void;
}

export function AppShell({ children, currentTab, onNavigate }: AppShellProps) {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-surface-container-lowest text-on-surface flex flex-col">
      <Navigation currentTab={currentTab} onSelectTab={onNavigate} />

      <main className="flex-1 pt-16 pb-20 xl:pb-0">
        {children}
      </main>

      <footer className="w-full bg-surface-container-lowest border-t border-outline-variant/20 mb-16 xl:mb-0">
        <div className="w-full px-margin py-1.5 flex items-center justify-between gap-space-sm font-label-sm text-label-sm text-tertiary">
          <div className="flex items-center gap-space-sm font-mono text-xs">
            <span>CORE STATUS: {user ? 'SYNCED' : 'LOCAL'}</span>
          </div>
          <div className="text-center font-mono text-[11px] text-tertiary flex-1 mx-2 truncate">
            CNC Copilot is an AI and it can make mistakes
          </div>
          <div className="flex items-center gap-space-md font-mono text-xs">
            <span className="text-on-surface-variant">© {new Date().getFullYear()} ALL RIGHTS RESERVED</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
