'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ScanLine,
  Network,
  Rows3,
  Crosshair,
  SlidersHorizontal,
  CircleAlert,
  History,
  TrendingUp,
  Waypoints,
  Settings,
  Sparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';

// One coherent icon per destination — geometric, restrained, and shared
// with that page's own header icon (see each page.tsx) so the same symbol
// means the same thing everywhere in the app, not a different pick per
// context.
const navGroups = [
  {
    title: 'Core',
    items: [
      { href: '/mission-control', label: 'Revenue Command', icon: LayoutDashboard },
      { href: '/revenue-scanner', label: 'Revenue Scanner', icon: ScanLine },
      { href: '/recovery-brain', label: 'Recovery Brain', icon: Network },
      { href: '/transactions', label: 'Transactions', icon: Rows3 },
    ]
  },
  {
    title: 'Operations',
    items: [
      { href: '/interventions', label: 'Interventions', icon: Crosshair },
      { href: '/policies', label: 'Recovery Controls', icon: SlidersHorizontal },
      { href: '/escalations', label: 'Escalations', icon: CircleAlert },
      { href: '/audit', label: 'Audit Trail', icon: History },
    ]
  },
  {
    title: 'Intelligence',
    items: [
      { href: '/analytics', label: 'Analytics', icon: TrendingUp },
      { href: '/integrations', label: 'Integrations', icon: Waypoints },
      { href: '/settings', label: 'Settings', icon: Settings },
    ]
  }
];

export const Sidebar: React.FC = () => {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-surface border-r border-border-subtle flex flex-col justify-between shrink-0 hidden md:flex">
      <div className="py-5 px-3 space-y-6 overflow-y-auto">
        {navGroups.map((group, gIdx) => (
          <div key={gIdx} className="space-y-1.5">
            <h3 className="rv-label rv-label-rule px-3 pb-1">
              {group.title}
            </h3>
            <div className="space-y-px">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`w-full flex items-center justify-between h-8 px-3 rounded-md text-[13px] font-medium tracking-[-0.005em] transition-colors relative group ${
                      isActive
                        ? 'text-text-primary bg-panel shadow-edge'
                        : 'text-text-secondary hover:text-text-primary hover:bg-panel/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon
                        strokeWidth={1.75}
                        className={`w-4 h-4 ${isActive ? 'text-primary-400' : 'text-text-muted group-hover:text-text-secondary'} transition-colors`}
                      />
                      <span>{item.label}</span>
                    </div>
                    {isActive && (
                      <motion.div
                        layoutId="activeNav"
                        className="absolute -left-3 top-1.5 bottom-1.5 w-[2px] bg-primary-500 rounded-r-full"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 pt-3 pb-4 border-t border-border-subtle space-y-4">
        <Link
          href="/copilot"
          className={`w-full flex items-center justify-between h-8 px-3 rounded-md text-[13px] font-medium tracking-[-0.005em] transition-colors ${
            pathname.startsWith('/copilot')
              ? 'text-text-primary bg-panel shadow-edge'
              : 'text-text-secondary hover:text-text-primary hover:bg-panel/60'
          }`}
        >
          <div className="flex items-center gap-3">
            <Sparkles strokeWidth={1.75} className={`w-4 h-4 ${pathname.startsWith('/copilot') ? 'text-ai-400' : 'text-text-muted'}`} />
            <span>AI Copilot</span>
          </div>
          <span className="px-1.5 py-px rounded-sm text-[9px] font-mono font-medium tracking-[0.1em] bg-ai-500/10 text-ai-300 border border-ai-500/25">
            BETA
          </span>
        </Link>

        {/* The product's one rule, as a legend: the violet node is intelligence,
            the silver square is the policy boundary that governs it. */}
        <div className="px-3 space-y-1.5 font-mono text-[9.5px] font-medium tracking-[0.14em] uppercase leading-none">
          <div className="flex items-center gap-2 text-text-muted" data-kind="decision">
            <span className="rv-node" aria-hidden />
            <span>AI for intelligence</span>
          </div>
          <div className="flex items-center gap-2 text-text-secondary" data-kind="policy">
            <span className="rv-node" aria-hidden />
            <span>Rules for control</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
