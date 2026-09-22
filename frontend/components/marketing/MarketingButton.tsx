'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useDashboardEntry } from '@/lib/use-dashboard-entry';
import { DashboardCTAContent } from './DashboardCTAContent';

type Variant = 'primary' | 'secondary' | 'ghost';

interface MarketingButtonProps {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
  icon?: React.ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-accent-600 border border-ink hover:border-accent-600',
  secondary: 'bg-transparent text-ink border border-hairline-strong hover:border-ink',
  ghost: 'bg-transparent text-ink-secondary hover:text-ink border border-transparent',
};

export function MarketingButton({ href, children, variant = 'primary', className = '', icon }: MarketingButtonProps) {
  const isDashboardEntry = href === '/mission-control';
  const { pending, onClick } = useDashboardEntry();

  return (
    <Link
      href={href}
      onClick={isDashboardEntry ? onClick : undefined}
      aria-disabled={isDashboardEntry && pending}
      className={cn(
        'relative inline-flex items-center gap-2 overflow-hidden rounded-md px-5 py-2.5 text-sm font-semibold transition-colors duration-150',
        variantClasses[variant],
        isDashboardEntry && pending && 'pointer-events-none opacity-90',
        className
      )}
    >
      {isDashboardEntry ? (
        <DashboardCTAContent pending={pending} icon={icon}>
          {children}
        </DashboardCTAContent>
      ) : (
        <>
          {children}
          {icon}
        </>
      )}
    </Link>
  );
}
