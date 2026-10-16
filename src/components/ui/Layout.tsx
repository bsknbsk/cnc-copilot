import React from 'react';

type CardAccent = 'orange' | 'cyan' | 'green' | 'amber' | 'red';

interface CardProps {
  children: React.ReactNode;
  accent?: CardAccent;
  className?: string;
  onClick?: () => void;
  interactive?: boolean;
}

export function Card({ children, accent, className = '', onClick, interactive }: CardProps) {
  const accentColors = {
    orange: 'border-t-primary-container',
    cyan: 'border-t-secondary',
    green: 'border-t-secondary-fixed-dim',
    amber: 'border-t-primary',
    red: 'border-t-error',
  };

  return (
    <div
      onClick={onClick}
      className={`
        bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden shadow-md
        ${accent ? `border-t-4 ${accentColors[accent]}` : ''}
        ${interactive || onClick ? 'cursor-pointer hover:border-outline-variant/60 transition-all hover:shadow-lg' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

interface GlassPanelProps {
  children: React.ReactNode;
  variant?: 'red' | 'dark';
  className?: string;
}

export function GlassPanel({ children, variant = 'dark', className = '' }: GlassPanelProps) {
  const variants = {
    red: 'bg-red-950/70 border-red-500/50 shadow-[0_12px_40px_rgba(239,68,68,0.35)]',
    dark: 'bg-surface-container-lowest/80 border-outline-variant/30 shadow-2xl',
  };

  return (
    <div className={`backdrop-blur-xl border rounded-2xl ${variants[variant]} ${className}`}>
      {children}
    </div>
  );
}
