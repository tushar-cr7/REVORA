'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, ArrowUpRight } from 'lucide-react';
import { RevoraLogo } from '@/components/brand/RevoraLogo';
import { cn } from '@/lib/utils';
import { useDashboardEntry } from '@/lib/use-dashboard-entry';
import { DashboardCTAContent } from './DashboardCTAContent';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/how-it-works', label: 'How it Works' },
  { href: '/trust', label: 'Trust & Security' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

export function MarketingNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dashboardEntry = useDashboardEntry();

  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-paper/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 sm:px-8">
        <Link href="/" className="flex items-center" onClick={() => setOpen(false)}>
          <RevoraLogo variant="primary" theme="light" width={128} height={36} />
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'text-sm font-medium transition-colors',
                  active ? 'text-ink' : 'text-ink-secondary hover:text-ink'
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link
            href="/mission-control"
            onClick={dashboardEntry.onClick}
            aria-disabled={dashboardEntry.pending}
            className={cn(
              'relative inline-flex items-center gap-1.5 overflow-hidden rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-600',
              dashboardEntry.pending && 'pointer-events-none opacity-90'
            )}
          >
            <DashboardCTAContent pending={dashboardEntry.pending} icon={<ArrowUpRight size={15} />}>
              Open Dashboard
            </DashboardCTAContent>
          </Link>
        </div>

        <button
          className="flex items-center justify-center rounded-md border border-hairline-strong p-2 text-ink lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-hairline bg-paper px-6 py-4 lg:hidden">
          <nav className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'rounded-md px-3 py-2.5 text-sm font-medium',
                  pathname === link.href ? 'bg-paper-alt text-ink' : 'text-ink-secondary'
                )}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/mission-control"
              onClick={(e) => {
                dashboardEntry.onClick(e);
                if (!e.defaultPrevented) setOpen(false);
              }}
              aria-disabled={dashboardEntry.pending}
              className={cn(
                'relative mt-2 inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-paper',
                dashboardEntry.pending && 'pointer-events-none opacity-90'
              )}
            >
              <DashboardCTAContent pending={dashboardEntry.pending} icon={<ArrowUpRight size={15} />}>
                Open Dashboard
              </DashboardCTAContent>
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
