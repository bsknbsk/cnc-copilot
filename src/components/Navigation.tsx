import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';

interface NavigationProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

export function Navigation({ currentTab, onSelectTab }: NavigationProps) {
  const { user, profile, isAdmin, login, logout, updatePreferences } = useAuth();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [controllerMenuOpen, setControllerMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const languages = [
    { code: 'en', label: 'English', short: 'EN' },
    { code: 'hi', label: 'हिन्दी (Hindi)', short: 'HI' },
    { code: 'ml', label: 'മലയാളം (Malayalam)', short: 'ML' },
    { code: 'ta', label: 'தமிழ் (Tamil)', short: 'TA' },
  ];

  const controllers = [
    { code: 'fanuc', label: 'Fanuc 0i-MF', short: 'Fanuc' },
    { code: 'mitsubishi', label: 'Mitsubishi M80', short: 'Mitsu' },
    { code: 'generic', label: 'Generic ISO G-Code', short: 'Generic' },
  ];

  const currentLang = languages.find((l) => l.code === (profile?.preferredLanguage || 'en')) || languages[0];
  const currentController = controllers.find((c) => c.code === (profile?.preferredController || 'fanuc')) || controllers[0];

  const handleLangSelect = (code: string) => {
    updatePreferences({ preferredLanguage: code as any });
    setLangMenuOpen(false);
  };

  const handleControllerSelect = (code: string) => {
    updatePreferences({ preferredController: code as any });
    setControllerMenuOpen(false);
  };

  return (
    <>
      {/* Persistent Industrial Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-surface-container-lowest/95 backdrop-blur-md shadow-[0_1px_8px_rgba(0,0,0,0.5)] border-b border-outline-variant/40">
        <div className="h-16 w-full px-margin flex items-center justify-between gap-space-md">
          {/* Brand Logo & Spindle Identity */}
          <div
            onClick={() => onSelectTab('home')}
            className="flex items-center gap-space-md min-w-max cursor-pointer select-none group"
          >
            <div className="w-10 h-10 rounded-xl bg-surface-container border border-outline-variant/50 flex items-center justify-center text-primary-container shadow-inner group-hover:border-primary-container/40 transition-colors">
              <span className="material-symbols-outlined text-[24px]">precision_manufacturing</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-space-sm">
                <span className="font-headline-sm text-headline-sm font-bold tracking-tight text-on-surface">
                  CNC Copilot
                </span>
                <span className="px-space-xs py-0.5 rounded bg-surface-container border border-outline-variant/40 font-label-sm text-label-sm uppercase text-secondary font-mono tracking-wider">
                  v2.4 Core
                </span>
              </div>
              <span className="font-label-sm text-label-sm text-tertiary-container font-mono tracking-tight hidden sm:inline">
                AI explains. Physics decides.
              </span>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden xl:flex items-center h-full gap-space-xs">
            <button
              onClick={() => onSelectTab('home')}
              className={`px-space-md py-space-sm rounded font-body-md text-body-md transition-colors ${
                currentTab === 'home'
                  ? 'bg-surface-container text-on-surface font-semibold shadow-inner'
                  : 'text-tertiary hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              Dashboard
            </button>

            <button
              onClick={() => onSelectTab('agent')}
              className={`px-space-md py-space-sm rounded font-body-md text-body-md transition-colors ${
                currentTab === 'agent'
                  ? 'bg-surface-container text-on-surface font-semibold shadow-inner'
                  : 'text-tertiary hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              Shopfloor Agent
            </button>

            <button
              onClick={() => onSelectTab('calculator')}
              className={`px-space-md py-space-sm rounded font-body-md text-body-md transition-colors ${
                currentTab === 'calculator'
                  ? 'bg-surface-container text-on-surface font-semibold shadow-inner'
                  : 'text-tertiary hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              Cutting Calculator
            </button>

            <button
              onClick={() => onSelectTab('gcode')}
              className={`px-space-md py-space-sm rounded font-body-md text-body-md transition-colors ${
                currentTab === 'gcode'
                  ? 'bg-surface-container text-on-surface font-semibold shadow-inner'
                  : 'text-tertiary hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              G-code Verifier
            </button>

            <button
              onClick={() => onSelectTab('academy')}
              className={`px-space-md py-space-sm rounded font-body-md text-body-md transition-colors ${
                currentTab === 'academy'
                  ? 'bg-surface-container text-on-surface font-semibold shadow-inner'
                  : 'text-tertiary hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              Academy
            </button>

            <button
              onClick={() => onSelectTab('kb')}
              className={`px-space-md py-space-sm rounded font-body-md text-body-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                currentTab === 'kb'
                  ? 'bg-surface-container text-on-surface font-semibold shadow-inner'
                  : 'text-tertiary hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <span>Knowledge Base</span>
              {isAdmin && (
                <span className="px-1.5 py-0.2 rounded bg-primary-container/20 text-primary-container font-label-sm text-[9px] font-mono font-bold">
                  ADMIN
                </span>
              )}
            </button>
          </nav>

          {/* Right Header Controls: Controller Selector, Language Selector, Notifications, Avatar */}
          <div className="flex items-center gap-space-sm min-w-max">
            {/* Shop Net Status Indicator matching Stitch HTML */}
            <div className="hidden sm:flex items-center gap-space-xs px-space-sm py-1.5 rounded bg-surface-container-low border border-outline-variant/10">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
              </span>
              <span className="font-label-sm text-label-sm text-tertiary font-mono tracking-tight whitespace-nowrap">
                Shop Net: {currentController.label.split(' ')[0]} <span className="text-secondary font-bold">ONLINE</span>
              </span>
            </div>

            {/* Preferred Controller Selector */}
            <div className="relative">
              <button
                onClick={() => setControllerMenuOpen(!controllerMenuOpen)}
                aria-label="Select Machine Controller"
                className="hidden md:flex items-center gap-space-xs px-space-sm py-1.5 rounded bg-surface-container text-tertiary hover:bg-surface-container-high hover:text-on-surface cursor-pointer transition-colors border border-outline-variant/40"
              >
                <span className="font-code-sm text-code-sm text-on-surface font-mono">
                  {currentController.short} / {currentLang.short}
                </span>
                <span className="material-symbols-outlined text-[16px] text-tertiary">unfold_more</span>
              </button>

              {controllerMenuOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl bg-surface-container border border-outline-variant shadow-xl py-1 z-50">
                  <div className="px-3 py-1.5 border-b border-surface-container-high text-[10px] font-mono uppercase text-tertiary tracking-wider">
                    Preferred Controller
                  </div>
                  {controllers.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => handleControllerSelect(c.code)}
                      className={`w-full text-left px-3 py-2 text-xs font-mono flex items-center justify-between hover:bg-surface-container-high transition-colors ${
                        (profile?.preferredController || 'fanuc') === c.code
                          ? 'text-secondary font-bold bg-secondary/10'
                          : 'text-on-surface'
                      }`}
                    >
                      <span>{c.label}</span>
                      {(profile?.preferredController || 'fanuc') === c.code && (
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Language Selector Dropdown */}
            <div className="relative">
              <button
                onClick={() => setLangMenuOpen(!langMenuOpen)}
                aria-label="Select Language"
                className="p-space-sm rounded bg-surface-container text-tertiary hover:bg-surface-container-high hover:text-on-surface transition-colors flex items-center justify-center border border-outline-variant/40"
              >
                <span className="material-symbols-outlined text-[20px]">language</span>
              </button>

              {langMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl bg-surface-container border border-outline-variant shadow-xl py-1 z-50">
                  <div className="px-3 py-1.5 border-b border-surface-container-high text-[10px] font-mono uppercase text-tertiary tracking-wider">
                    Language
                  </div>
                  {languages.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => handleLangSelect(l.code)}
                      className={`w-full text-left px-3 py-2 text-xs font-mono flex items-center justify-between hover:bg-surface-container-high transition-colors ${
                        (profile?.preferredLanguage || 'en') === l.code
                          ? 'text-primary-container font-bold bg-primary-container/10'
                          : 'text-on-surface'
                      }`}
                    >
                      <span>{l.label}</span>
                      {(profile?.preferredLanguage || 'en') === l.code && (
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Notifications Alert Icon */}
            <button
              aria-label="Notifications"
              className="p-space-sm rounded bg-surface-container text-tertiary hover:bg-surface-container-high hover:text-on-surface transition-colors flex items-center justify-center border border-outline-variant/40"
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">notifications</span>
            </button>

            {/* User Avatar Menu or Sign In CTA */}
            {user ? (
              <div className="relative pl-space-xs">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  aria-label="User Profile Menu"
                  className="flex items-center rounded-full hover:ring-2 hover:ring-secondary transition-all"
                >
                  {user.photoURL ? (
                    <img
                      alt="Operator Avatar"
                      className="w-8 h-8 rounded-full object-cover border border-outline-variant/60"
                      src={user.photoURL}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-bold text-xs font-mono">
                      {(user.displayName || user.email || 'OP')[0].toUpperCase()}
                    </div>
                  )}
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 rounded-xl bg-surface-container border border-outline-variant shadow-2xl p-space-sm z-50">
                    <div className="px-3 py-2 border-b border-surface-container-high mb-1">
                      <p className="font-headline-sm text-sm font-bold text-on-surface truncate">
                        {profile?.displayName || user.displayName || 'Operator'}
                      </p>
                      <p className="font-code-sm text-[11px] text-tertiary truncate">{user.email}</p>
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-surface-container-high font-label-sm text-secondary font-mono">
                          {currentController.label}
                        </span>
                        {isAdmin && (
                          <span className="px-1.5 py-0.5 rounded bg-primary-container/20 text-primary font-label-sm font-mono font-bold">
                            ADMIN
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-mono text-error hover:bg-error-container/20 rounded-lg flex items-center gap-2 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">logout</span>
                      <span>Sign out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={login}
                aria-label="Sign in with Google"
                className="h-10 px-space-md bg-primary-container text-on-primary font-headline-sm text-xs font-bold rounded-lg flex items-center gap-space-xs hover:brightness-110 active:scale-95 transition-all shadow-md"
              >
                <span className="material-symbols-outlined text-[18px]">login</span>
                <span>Sign in</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Bottom Tab Bar */}
      <nav className="xl:hidden fixed bottom-0 left-0 right-0 h-16 bg-surface-container-lowest/95 backdrop-blur-lg border-t border-outline-variant/40 z-50 px-2 flex items-center justify-around">
        <button
          onClick={() => onSelectTab('home')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg transition-colors touch-target ${
            currentTab === 'home' ? 'text-primary-container font-bold' : 'text-tertiary'
          }`}
        >
          <span className="material-symbols-outlined text-[22px]">dashboard</span>
          <span className="font-label-sm text-[10px] mt-0.5">Home</span>
        </button>

        <button
          onClick={() => onSelectTab('agent')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg transition-colors touch-target ${
            currentTab === 'agent' ? 'text-primary-container font-bold' : 'text-tertiary'
          }`}
        >
          <span className="material-symbols-outlined text-[22px]">smart_toy</span>
          <span className="font-label-sm text-[10px] mt-0.5">Agent</span>
        </button>

        <button
          onClick={() => onSelectTab('calculator')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg transition-colors touch-target ${
            currentTab === 'calculator' ? 'text-secondary font-bold' : 'text-tertiary'
          }`}
        >
          <span className="material-symbols-outlined text-[22px]">calculate</span>
          <span className="font-label-sm text-[10px] mt-0.5">Calc</span>
        </button>

        <button
          onClick={() => onSelectTab('gcode')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg transition-colors touch-target ${
            currentTab === 'gcode' ? 'text-secondary-fixed font-bold' : 'text-tertiary'
          }`}
        >
          <span className="material-symbols-outlined text-[22px]">terminal</span>
          <span className="font-label-sm text-[10px] mt-0.5">G-code</span>
        </button>

        <button
          onClick={() => onSelectTab('academy')}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg transition-colors touch-target ${
            currentTab === 'academy' ? 'text-primary font-bold' : 'text-tertiary'
          }`}
        >
          <span className="material-symbols-outlined text-[22px]">school</span>
          <span className="font-label-sm text-[10px] mt-0.5">Academy</span>
        </button>
      </nav>
    </>
  );
}
