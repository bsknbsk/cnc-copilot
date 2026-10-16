import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Navigation } from './components/Navigation.js';
import { LandingPage } from './components/LandingPage.js';
import { Dashboard } from './components/Dashboard.js';
import { CuttingCalculator } from './components/calculator/CuttingCalculator.js';
import { KnowledgeBase } from './components/KnowledgeBase.js';
import { GCodeVerifier } from './components/GCodeVerifier.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { GlobalErrorHandler } from './components/GlobalErrorHandler.js';
import { ShopfloorAgent } from './components/ShopfloorAgent.js';
import { AppShell } from './components/ui/AppShell.js';
import { MissionMap } from './components/academy/MissionMap.js';
import { MissionView } from './components/academy/MissionView.js';

type TabType = 'home' | 'agent' | 'calculator' | 'gcode' | 'academy' | 'kb';

function getTabFromPath(): TabType {
  if (typeof window === 'undefined') return 'home';
  const path = window.location.pathname.replace(/^\/+/, '').split('/')[0];
  if (['agent', 'calculator', 'gcode', 'academy', 'kb'].includes(path)) {
    return path as TabType;
  }
  return 'home';
}

function AppContent() {
  const { user, loading, isAdmin } = useAuth();
  const [currentTab, setCurrentTab] = useState<TabType>(getTabFromPath);
  const [navigationState, setNavigationState] = useState<any>(null);

  // Synchronize browser history and popstate navigation (e.g. forward/back buttons or direct /agent URL)
  useEffect(() => {
    const handlePopState = () => {
      setCurrentTab(getTabFromPath());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleNavigate = (tab: string, state?: any) => {
    const targetTab = tab as TabType;
    setCurrentTab(targetTab);
    setNavigationState(state || null);

    const targetPath = targetTab === 'home' ? '/' : `/${targetTab}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-container-lowest flex flex-col items-center justify-center gap-4 text-tertiary">
        <div className="w-12 h-12 rounded-xl bg-surface-container border border-outline-variant/40 flex items-center justify-center text-primary-container animate-spin">
          <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full" />
        </div>
        <div className="flex flex-col items-center gap-1 font-mono">
          <span className="text-xs uppercase tracking-wider text-on-surface">Connecting Kinematic Link</span>
          <span className="text-[11px] text-tertiary-container">Verifying Firebase credentials...</span>
        </div>
      </div>
    );
  }

  return (
    <AppShell currentTab={currentTab} onNavigate={handleNavigate}>
      {currentTab === 'home' && (
        <ErrorBoundary route="home" onNavigateHome={() => handleNavigate('home')}>
          {user ? <Dashboard onNavigate={handleNavigate} /> : <LandingPage onNavigate={handleNavigate} />}
        </ErrorBoundary>
      )}

      {currentTab === 'agent' && (
        <ErrorBoundary route="agent" onNavigateHome={() => handleNavigate('home')}>
          <ShopfloorAgent
            initialChatId={navigationState?.chatId}
            initialCamera={Boolean(navigationState?.openCamera)}
            initialQuery={navigationState?.manualQuery}
            onNavigate={handleNavigate}
          />
        </ErrorBoundary>
      )}

      {currentTab === 'calculator' && (
        <ErrorBoundary route="calculator" onNavigateHome={() => handleNavigate('home')}>
          <CuttingCalculator />
        </ErrorBoundary>
      )}

      {currentTab === 'gcode' && (
        <ErrorBoundary route="gcode" onNavigateHome={() => handleNavigate('home')}>
          <GCodeVerifier onNavigate={handleNavigate} />
        </ErrorBoundary>
      )}

      {currentTab === 'academy' && (
        <ErrorBoundary route="academy" onNavigateHome={() => handleNavigate('home')}>
          {navigationState?.missionId ? (
            <MissionView 
              missionId={navigationState.missionId} 
              onBack={() => handleNavigate('academy')} 
              onNavigate={handleNavigate}
            />
          ) : (
            <MissionMap onNavigate={handleNavigate} />
          )}
        </ErrorBoundary>
      )}

      {currentTab === 'kb' && (
        <ErrorBoundary route="kb" onNavigateHome={() => handleNavigate('home')}>
          <KnowledgeBase onNavigate={handleNavigate} />
        </ErrorBoundary>
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary route="root">
      <GlobalErrorHandler>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </GlobalErrorHandler>
    </ErrorBoundary>
  );
}
