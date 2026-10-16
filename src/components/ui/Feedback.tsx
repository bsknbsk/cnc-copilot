import React from 'react';

interface TabsProps {
  tabs: { id: string; label: string; icon?: string }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, className = '' }: TabsProps) {
  return (
    <div className={`flex items-center gap-1.5 p-1 bg-surface-container-low border border-outline-variant/30 rounded-xl ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono uppercase font-bold transition-all cursor-pointer
              ${isActive ? 'bg-primary-container text-on-primary shadow-md' : 'text-tertiary hover:bg-surface-container hover:text-on-surface'}
            `}
          >
            {tab.icon && <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Skeleton({ className = '', variant = 'rect' }: { className?: string; variant?: 'rect' | 'circle' | 'text' }) {
  const base = "bg-surface-container animate-pulse";
  const variants = {
    rect: "rounded-lg",
    circle: "rounded-full",
    text: "rounded-md h-3 w-full",
  };
  return <div className={`${base} ${variants[variant]} ${className}`} />;
}

export function ProgressBar({ progress, label, variant = 'primary' }: { progress: number; label?: string; variant?: 'primary' | 'secondary' | 'tertiary' }) {
  const colors = {
    primary: 'bg-primary-container',
    secondary: 'bg-secondary',
    tertiary: 'bg-tertiary',
  };

  return (
    <div className="w-full space-y-1.5">
      {(label || progress !== undefined) && (
        <div className="flex justify-between text-[10px] font-mono uppercase font-bold">
          <span className="text-tertiary">{label}</span>
          <span className="text-on-surface">{Math.round(progress)}%</span>
        </div>
      )}
      <div className="h-1.5 w-full bg-surface-container rounded-full overflow-hidden border border-outline-variant/20 shadow-inner">
        <div
          className={`h-full transition-all duration-500 ease-out ${colors[variant]}`}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    </div>
  );
}

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Drawer({ isOpen, onClose, title, children, footer }: DrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-container-lowest border-l border-outline-variant/40 shadow-2xl flex flex-col h-full animate-slide-in-right">
        <div className="p-4 border-b border-outline-variant/30 flex items-center justify-between">
          <h2 className="font-headline-sm text-base font-bold text-on-surface">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-surface-container rounded-lg text-tertiary hover:text-on-surface transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </div>
        {footer && (
          <div className="p-4 border-t border-outline-variant/30 bg-surface-container-low">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
