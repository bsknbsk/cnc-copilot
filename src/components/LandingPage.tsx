import React from 'react';
import { useAuth } from '../context/AuthContext.js';
import { Hero3DScene } from './Hero3DScene.js';

interface LandingPageProps {
  onNavigate?: (tab: string, state?: any) => void;
}

export function LandingPage({ onNavigate }: LandingPageProps = {}) {
  const { login } = useAuth();

  const scrollToHowItWorks = () => {
    document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col w-full pb-20">
      {/* Hero Section */}
      <section className="min-h-[calc(100vh-4rem)] flex items-center py-12 px-margin max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center w-full">
          {/* Left Hero Content */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container border border-outline-variant/40 w-fit">
              <span className="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
              <span className="font-label-sm text-xs font-mono text-tertiary">
                AI explains. <strong className="text-secondary">Physics decides.</strong>
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-on-surface leading-[1.1]">
              Your machine stopped.{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-container to-secondary">
                Copilot knows why.
              </span>
            </h1>

            <p className="font-body-lg text-base sm:text-lg text-tertiary max-w-2xl leading-relaxed">
              Snap the alarm screen, ask in your language, get the fix from your own controller manual, with the page number.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                onClick={login}
                className="touch-target px-6 py-3 rounded-xl bg-primary-container hover:bg-primary-container/90 text-on-primary font-bold text-base flex items-center justify-center gap-2 shadow-xl shadow-primary-container/20 active:scale-95 transition-all cursor-pointer"
              >
                <span>Sign in with Google</span>
                <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
              </button>

              <button
                onClick={scrollToHowItWorks}
                className="touch-target px-6 py-3 rounded-xl bg-surface-container hover:bg-surface-container-high border border-outline-variant text-on-surface font-semibold text-base flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <span>See how it works</span>
                <span className="material-symbols-outlined text-[20px] text-tertiary">expand_more</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-outline-variant/40 text-xs font-mono text-tertiary">
              <div>
                <span className="block text-on-surface font-bold text-sm">Deterministic</span>
                <span>Kienzle cutting physics</span>
              </div>
              <div>
                <span className="block text-secondary font-bold text-sm">Grounded</span>
                <span>Controller manual citations</span>
              </div>
              <div>
                <span className="block text-primary-container font-bold text-sm">Multilingual</span>
                <span>Hindi, Tamil, Malayalam</span>
              </div>
            </div>
          </div>

          {/* Right Hero 3D Scene */}
          <div className="lg:col-span-5 w-full">
            <Hero3DScene />
          </div>
        </div>
      </section>

      {/* "Fix today's machine" Section: 3 Cards */}
      <section className="py-16 px-margin max-w-7xl mx-auto w-full">
        <div className="flex flex-col gap-2 mb-8">
          <span className="font-label-sm text-xs font-mono uppercase tracking-wider text-primary-container">
            Core Diagnostics Suite
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">Fix today's machine</h2>
          <p className="font-body-sm text-sm text-tertiary">
            Instant resolution of alarms, optimal cutting physics, and kinematic G-code sanity verification.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Shopfloor Agent */}
          <div
            onClick={() => onNavigate?.('agent')}
            className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/30 flex flex-col justify-between shadow-md hover:border-primary-container/40 transition-all cursor-pointer group"
          >
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary-container/10 border border-primary-container/30 flex items-center justify-center text-primary-container group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[28px]">smart_toy</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-on-surface mb-1 group-hover:text-primary-container transition-colors">Shopfloor Agent</h3>
                <p className="text-sm text-tertiary leading-relaxed">
                  Voice, photo, or code diagnosis. Analyzes pendant alarms, cross-references your uploaded manuals, and cites exact manual page numbers.
                </p>
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-outline-variant/30 flex items-center justify-between text-xs font-mono text-primary-container">
              <span>Camera • Voice • Citations</span>
              <span className="material-symbols-outlined text-[16px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </div>
          </div>

          {/* Card 2: Cutting Calculator */}
          <div
            onClick={() => onNavigate?.('calculator')}
            className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/30 flex flex-col justify-between shadow-md hover:border-secondary/40 transition-all cursor-pointer group"
          >
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 rounded-xl bg-secondary/10 border border-secondary/30 flex items-center justify-center text-secondary group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[28px]">calculate</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-on-surface mb-1 group-hover:text-secondary transition-colors">Cutting Calculator</h3>
                <p className="text-sm text-tertiary leading-relaxed">
                  Rigorous Kienzle force and chip thickness math for milling, turning, drilling, and tapping. Real-time machine power gauge and torque limits.
                </p>
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-outline-variant/30 flex items-center justify-between text-xs font-mono text-secondary">
              <span>Physics Engine • Zero Guesswork</span>
              <span className="material-symbols-outlined text-[16px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </div>
          </div>

          {/* Card 3: G-code Verifier */}
          <div
            onClick={() => onNavigate?.('gcode')}
            className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/30 flex flex-col justify-between shadow-md hover:border-secondary-fixed/40 transition-all cursor-pointer group"
          >
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 rounded-xl bg-secondary-fixed/10 border border-secondary-fixed/30 flex items-center justify-center text-secondary-fixed group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[28px]">terminal</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-on-surface mb-1 group-hover:text-secondary-fixed transition-colors">G-code Verifier</h3>
                <p className="text-sm text-tertiary leading-relaxed">
                  Deterministic syntax & motion parser with 3D kinematic backplot. Catches rapid plunges into stock, missing G43 offsets, and spindle-off feeds.
                </p>
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-outline-variant/30 flex items-center justify-between text-xs font-mono text-secondary-fixed">
              <span>3D Backplot • Gemini Pro Review</span>
              <span className="material-symbols-outlined text-[16px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </div>
          </div>
        </div>
      </section>

      {/* "Build tomorrow's operator": Academy Band */}
      <section className="py-16 px-margin max-w-7xl mx-auto w-full">
        <div className="bg-surface-container-low p-8 sm:p-10 rounded-xl border border-outline-variant/40 border-l-4 border-l-primary-container relative overflow-hidden shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-primary-container text-[22px]">school</span>
                <span className="font-label-sm text-xs font-mono uppercase tracking-wider text-primary-container">
                  Operator Academy • Crash Lab
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">
                Crash the machine here. Never on the shop floor.
              </h2>
              <p className="font-body-sm text-sm text-tertiary mt-1">
                Gamified 3D kinematic training missions with real repair cost calculations (INR) and interactive AI instructor hints.
              </p>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-primary-container/10 border border-primary-container/30 text-xs font-mono text-primary-container self-start md:self-auto font-bold">
              Phase 2: VR operator training
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/30">
              <div className="flex justify-between items-center text-xs font-mono mb-2">
                <span className="text-primary-container font-bold">Mission 01</span>
                <span className="text-secondary">100 XP</span>
              </div>
              <h4 className="text-sm font-bold text-on-surface mb-1">The Missing Offset</h4>
              <p className="text-xs text-tertiary">Fix the dangerous G00 move omitting G43 H01 before the spindle plunges.</p>
            </div>

            <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/30">
              <div className="flex justify-between items-center text-xs font-mono mb-2">
                <span className="text-primary-container font-bold">Mission 02</span>
                <span className="text-secondary">120 XP</span>
              </div>
              <h4 className="text-sm font-bold text-on-surface mb-1">Rapid Into Stock</h4>
              <p className="text-xs text-tertiary">Separate high-speed positioning from controlled feed into raw billet.</p>
            </div>

            <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/30">
              <div className="flex justify-between items-center text-xs font-mono mb-2">
                <span className="text-primary-container font-bold">Mission 03</span>
                <span className="text-secondary">150 XP</span>
              </div>
              <h4 className="text-sm font-bold text-on-surface mb-1">Stripped Tap</h4>
              <p className="text-xs text-tertiary">Synchronize rigid tapping feed rate (F = S x pitch) to prevent tap breakage.</p>
            </div>

            <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/30">
              <div className="flex justify-between items-center text-xs font-mono mb-2">
                <span className="text-primary-container font-bold">Mission 04</span>
                <span className="text-secondary">100 XP</span>
              </div>
              <h4 className="text-sm font-bold text-on-surface mb-1">Dead Spindle</h4>
              <p className="text-xs text-tertiary">Catch inactive spindle rotation (M05) before cutting engagement.</p>
            </div>
          </div>
        </div>
      </section>

      {/* "How it works": 4 Step Horizontal Flow */}
      <section id="how-it-works" className="py-16 px-margin max-w-7xl mx-auto w-full">
        <div className="flex flex-col gap-2 mb-10 text-center max-w-2xl mx-auto">
          <span className="font-label-sm text-xs font-mono uppercase tracking-wider text-secondary">
            Deterministic Workflow
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">How it works</h2>
          <p className="font-body-sm text-sm text-tertiary">
            From machine alarm to grounded physical action in under ten seconds.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/30 flex flex-col gap-3 shadow-md">
            <div className="w-10 h-10 rounded-lg bg-surface-container border border-outline-variant flex items-center justify-center text-primary-container font-mono font-bold">
              01
            </div>
            <h3 className="font-headline-sm font-bold text-base text-on-surface">Ask</h3>
            <p className="text-xs text-tertiary leading-relaxed">
              Capture a photo of the CNC pendant, speak through your headset, or type G-code blocks directly.
            </p>
          </div>

          <div className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/30 flex flex-col gap-3 shadow-md">
            <div className="w-10 h-10 rounded-lg bg-surface-container border border-outline-variant flex items-center justify-center text-secondary font-mono font-bold">
              02
            </div>
            <h3 className="font-headline-sm font-bold text-base text-on-surface">Retrieve</h3>
            <p className="text-xs text-tertiary leading-relaxed">
              Google File Search queries your OEM manuals and shop standards with strict controller metadata filtering.
            </p>
          </div>

          <div className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/30 flex flex-col gap-3 shadow-md">
            <div className="w-10 h-10 rounded-lg bg-surface-container border border-outline-variant flex items-center justify-center text-secondary-fixed font-mono font-bold">
              03
            </div>
            <h3 className="font-headline-sm font-bold text-base text-on-surface">Compute</h3>
            <p className="text-xs text-tertiary leading-relaxed">
              Pure TypeScript physics and kinematic collision engines verify limits, feeds, speeds, and toolpath geometries.
            </p>
          </div>

          <div className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/30 flex flex-col gap-3 shadow-md">
            <div className="w-10 h-10 rounded-lg bg-surface-container border border-outline-variant flex items-center justify-center text-primary font-mono font-bold">
              04
            </div>
            <h3 className="font-headline-sm font-bold text-base text-on-surface">Answer</h3>
            <p className="text-xs text-tertiary leading-relaxed">
              Gemini delivers concise, actionable instructions in your preferred language with exact manual page citations.
            </p>
          </div>
        </div>
      </section>

      {/* "Built on Google" Stack Grid */}
      <section className="py-12 px-margin max-w-7xl mx-auto w-full border-t border-outline-variant/30">
        <div className="flex flex-col items-center gap-2 mb-6 text-center">
          <span className="font-label-sm text-xs font-mono uppercase tracking-wider text-tertiary">Infrastructure</span>
          <h3 className="font-headline-md text-xl font-bold text-on-surface">Built on Google Cloud & AI Platform</h3>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
          <div className="p-3 rounded-xl bg-surface-container border border-outline-variant/30 font-mono text-xs text-on-surface">
            <span className="block font-bold text-primary-container mb-0.5">Gemini 3.8</span>
            <span className="text-[10px] text-tertiary">Flash & Live</span>
          </div>
          <div className="p-3 rounded-xl bg-surface-container border border-outline-variant/30 font-mono text-xs text-on-surface">
            <span className="block font-bold text-secondary mb-0.5">File Search</span>
            <span className="text-[10px] text-tertiary">Semantic RAG</span>
          </div>
          <div className="p-3 rounded-xl bg-surface-container border border-outline-variant/30 font-mono text-xs text-on-surface">
            <span className="block font-bold text-on-surface mb-0.5">Google AI Studio</span>
            <span className="text-[10px] text-tertiary">Build Platform</span>
          </div>
          <div className="p-3 rounded-xl bg-surface-container border border-outline-variant/30 font-mono text-xs text-on-surface">
            <span className="block font-bold text-secondary-fixed mb-0.5">Antigravity</span>
            <span className="text-[10px] text-tertiary">Workflow Runtime</span>
          </div>
          <div className="p-3 rounded-xl bg-surface-container border border-outline-variant/30 font-mono text-xs text-on-surface">
            <span className="block font-bold text-primary mb-0.5">Cloud Run</span>
            <span className="text-[10px] text-tertiary">Serverless Container</span>
          </div>
          <div className="p-3 rounded-xl bg-surface-container border border-outline-variant/30 font-mono text-xs text-on-surface">
            <span className="block font-bold text-primary-container mb-0.5">Firebase</span>
            <span className="text-[10px] text-tertiary">Firestore & Auth</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t border-outline-variant/30 mt-8 pt-8 px-margin max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 font-label-sm text-xs font-mono text-tertiary">
        <div>
          <span>CNC Copilot | Built for Google Cloud AI Builder Cup 2026</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#" className="hover:text-on-surface transition-colors">
            GitHub Repository
          </a>
          <span>•</span>
          <span>STATION ID: MC-094</span>
          <span>•</span>
          <span className="text-secondary font-bold">V2.4 CORE</span>
        </div>
      </footer>
    </div>
  );
}
