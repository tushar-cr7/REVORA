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
    <aside className="w-64 bg-surface border-r border-border-subtle flex flex-col justify-between shrink-0 hidden md:flex">
      <div className="py-6 px-4 space-y-8 overflow-y-auto">
        {navGroups.map((group, gIdx) => (
          <div key={gIdx} className="space-y-2">
            <h3 className="px-3 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              {group.title}
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] font-medium transition-colors relative group ${
                      isActive
                        ? 'text-text-primary bg-panel-raised'
                        : 'text-text-secondary hover:text-text-primary hover:bg-panel/50'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <Icon
                        strokeWidth={1.75}
                        className={`w-4 h-4 ${isActive ? 'text-primary-400' : 'text-text-muted group-hover:text-text-secondary'} transition-colors`}
                      />
                      <span>{item.label}</span>
                    </div>
                    {isActive && (
                      <motion.div 
                        layoutId="activeNav"
                        className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary-500 rounded-r-full"
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

      <div className="p-4 border-t border-border-subtle">
        <div className="space-y-1 mb-4">
          <Link
            href="/copilot"
            className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
              pathname.startsWith('/copilot')
                ? 'text-text-primary bg-panel-raised'
                : 'text-text-secondary hover:text-text-primary hover:bg-panel/50'
            }`}
          >
            <div className="flex items-center space-x-3">
              <Sparkles strokeWidth={1.75} className={`w-4 h-4 ${pathname.startsWith('/copilot') ? 'text-ai-400' : 'text-text-muted'}`} />
              <span>AI Copilot</span>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-ai-500/20 text-ai-300 border border-ai-500/30">
              BETA
            </span>
          </Link>
        </div>
      </div>
    </aside>
  );
};
