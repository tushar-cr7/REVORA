import React from 'react';
import Link from 'next/link';
import { RevoraLogo } from '@/components/brand/RevoraLogo';

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/how-it-works', label: 'How it Works' },
      { href: '/trust', label: 'Trust & Security' },
      { href: '/mission-control', label: 'Dashboard' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-hairline bg-paper-alt">
      <div className="mx-auto max-w-7xl px-6 py-14 sm:px-8">
        <div className="flex flex-col gap-12 lg:flex-row lg:justify-between">
          <div className="max-w-sm">
            <RevoraLogo variant="primary" theme="light" width={132} height={38} />
            <p className="mt-4 text-sm leading-relaxed text-ink-secondary">
              Intelligent revenue recovery infrastructure. AI estimates and proposes;
              a deterministic policy engine is the only thing that authorizes money movement.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:gap-16">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {col.title}
                </div>
                <ul className="mt-4 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-ink-secondary hover:text-ink">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-hairline pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-muted">
            &copy; {new Date().getFullYear()} REVORA. Demo environment — simulated execution, test-mode only.
          </p>
          <p className="text-xs text-ink-muted">AI for intelligence. Rules for control.</p>
        </div>
      </div>
    </footer>
  );
}
