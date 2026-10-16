import React from 'react';

interface PageHeaderProps {
  label?: string;
  title: string;
  caption?: string;
  actions?: React.ReactNode;
  icon?: string;
}

export function PageHeader({ label, title, caption, actions, icon }: PageHeaderProps) {
  return (
    <div className="bg-surface-container-low rounded-2xl border border-outline-variant/30 p-4 sm:p-6 mb-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        {icon && (
          <div className="w-12 h-12 rounded-xl bg-primary-container/10 border border-primary-container/30 flex items-center justify-center text-primary-container shadow-inner">
            <span className="material-symbols-outlined text-[28px]">{icon}</span>
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {label && (
              <span className="px-2 py-0.5 rounded bg-surface-container border border-outline-variant/40 text-[10px] font-mono uppercase tracking-wider text-primary-container font-semibold">
                {label}
              </span>
            )}
            <h1 className="font-headline-md text-xl font-bold text-on-surface truncate">
              {title}
            </h1>
          </div>
          {caption && (
            <p className="font-body-sm text-xs text-tertiary mt-0.5 truncate">
              {caption}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  count?: number;
  icon?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, count, icon, actions, className = '' }: SectionHeaderProps) {
  return (
    <div className={`flex items-center justify-between pb-3 mb-3 border-b border-outline-variant/30 ${className}`}>
      <div className="flex items-center gap-2">
        {icon && <span className="material-symbols-outlined text-[18px] text-tertiary">{icon}</span>}
        <span className="text-xs font-mono uppercase tracking-wider text-tertiary font-semibold">
          {title}
        </span>
        {count !== undefined && (
          <span className="px-1.5 py-0.5 rounded bg-surface-container font-mono text-[10px] text-tertiary">
            {count}
          </span>
        )}
      </div>
      {actions && <div>{actions}</div>}
    </div>
  );
}

interface StatChipProps {
  label: string;
  value: string | number;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'tertiary';
  onClick?: () => void;
}

export function StatChip({ label, value, icon, variant = 'primary', onClick }: StatChipProps) {
  const colors = {
    primary: 'text-primary-container',
    secondary: 'text-secondary',
    tertiary: 'text-tertiary',
  };

  return (
    <div 
      onClick={onClick}
      className={`flex items-center gap-2 bg-surface-container px-3 py-1.5 rounded-xl border border-outline-variant/40 ${onClick ? 'cursor-pointer hover:bg-surface-container-high transition-colors' : ''}`}
    >
      {icon && <span className={`material-symbols-outlined text-[18px] ${colors[variant]}`}>{icon}</span>}
      <span className="text-[11px] font-mono text-tertiary uppercase whitespace-nowrap">{label}:</span>
      <span className="font-mono text-xs text-on-surface font-bold">{value}</span>
    </div>
  );
}

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-4 text-tertiary">
      <div className="w-16 h-16 rounded-2xl bg-surface-container border border-outline-variant/40 flex items-center justify-center text-primary-container shadow-inner mb-2">
        <span className="material-symbols-outlined text-[32px] opacity-60">{icon}</span>
      </div>
      <div className="max-w-xs space-y-1">
        <h3 className="font-headline-sm text-sm font-bold text-on-surface">{title}</h3>
        <p className="text-xs font-body-sm leading-relaxed">{description}</p>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
