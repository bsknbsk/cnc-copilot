import React from 'react';

type BadgeVariant = 'primary' | 'secondary' | 'tertiary' | 'error' | 'success' | 'warning';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = 'primary', className = '' }: BadgeProps) {
  const variants = {
    primary: 'bg-primary-container/12 border-primary-container/40 text-primary-container',
    secondary: 'bg-secondary-container/12 border-secondary-container/40 text-secondary',
    tertiary: 'bg-tertiary-container/12 border-tertiary-container/40 text-tertiary',
    error: 'bg-error-container/12 border-error-container/40 text-error',
    success: 'bg-secondary/12 border-secondary/40 text-secondary',
    warning: 'bg-primary/12 border-primary/40 text-primary',
  };

  return (
    <span className={`px-1.5 py-0.5 rounded-[4px] border font-label-sm text-[10px] uppercase font-mono font-bold tracking-wider ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
