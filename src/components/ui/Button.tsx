import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  icon?: string;
  loading?: boolean;
}

export function ButtonPrimary({ children, icon, loading, className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`h-10 px-4 rounded-xl bg-primary-container text-on-primary font-headline-sm text-xs font-bold flex items-center justify-center gap-space-sm hover:brightness-110 active:scale-95 transition-all shadow-md shadow-primary-container/20 disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${className}`}
      {...props}
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
      ) : icon ? (
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}

export function ButtonSecondary({ children, icon, loading, className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`h-10 px-4 rounded-xl bg-surface-container border border-outline-variant/40 text-on-surface font-headline-sm text-xs font-bold flex items-center justify-center gap-space-sm hover:bg-surface-container-high active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${className}`}
      {...props}
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
      ) : icon ? (
        <span className="material-symbols-outlined text-[18px] text-tertiary">{icon}</span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}

export function ButtonDanger({ children, icon, loading, className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`h-10 px-4 rounded-xl bg-error-container/20 border border-error-container/40 text-error font-headline-sm text-xs font-bold flex items-center justify-center gap-space-sm hover:bg-error-container/30 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${className}`}
      {...props}
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-error border-t-transparent rounded-full animate-spin" />
      ) : icon ? (
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ icon, title, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string }) {
  return (
    <button
      className={`w-12 h-12 min-h-[48px] min-w-[48px] rounded-xl bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 flex items-center justify-center text-tertiary hover:text-on-surface transition-all cursor-pointer ${className}`}
      title={title}
      {...props}
    >
      <span className="material-symbols-outlined text-[24px]">{icon}</span>
    </button>
  );
}
