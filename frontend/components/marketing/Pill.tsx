import React from 'react';
import { cn } from '@/lib/utils';

export function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-hairline-strong bg-paper-raised px-3 py-1',
        'text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary',
        className
      )}
    >
      {children}
    </span>
  );
}
