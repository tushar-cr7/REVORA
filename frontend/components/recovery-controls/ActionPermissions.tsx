'use client';

import React from 'react';
import { RotateCcw, Link2, Bell, UserCheck, PauseCircle } from 'lucide-react';
import { ACTION_LABEL } from '@/lib/actionMeta';

type PermissionMode = 'automatic' | 'review' | 'hold';

interface ActionPermission {
  action: keyof typeof ACTION_LABEL;
  icon: React.ElementType;
  mode: PermissionMode;
  badge: string;
  condition: string;
}

/**
 * Right half of the signature section: one card per real Action enum value
 * (backend/app/domain/models.py). "mode" and "condition" reflect the actual
 * reroute rules in evaluate_policy() (backend/app/domain/policy.py) — not
 * invented capabilities. Escalate and suppress are never themselves blocked
 * by policy; they are the reroute targets other actions fall back to.
 */
const PERMISSIONS: ActionPermission[] = [
  {
    action: 'retry',
    icon: RotateCcw,
    mode: 'automatic',
    badge: 'Automatic within limits',
    condition: 'Runs on its own, within the retry limit, cooldown, and subscription health checks.',
  },
  {
    action: 'payment_link',
    icon: Link2,
    mode: 'automatic',
    badge: 'Automatic within limits',
    condition: 'Sent on its own, within the customer contact frequency and value ceiling.',
  },
  {
    action: 'reminder',
    icon: Bell,
    mode: 'automatic',
    badge: 'Automatic within limits',
    condition: 'Sent on its own, within the contact frequency, value ceiling, and invoice age checks.',
  },
  {
    action: 'escalate',
    icon: UserCheck,
    mode: 'review',
    badge: 'Always reviewed',
    condition: 'Always handed to you. REVORA never resolves this on its own.',
  },
  {
    action: 'suppress',
    icon: PauseCircle,
    mode: 'hold',
    badge: 'Automatic hold',
    condition: 'A deliberate no-action, taken when a contact or cooldown limit has been reached.',
  },
];

const MODE_STYLE: Record<PermissionMode, { text: string; bg: string; border: string }> = {
  automatic: { text: 'text-success-400', bg: 'bg-success-500/10', border: 'border-success-500/25' },
  review: { text: 'text-warning-400', bg: 'bg-warning-500/10', border: 'border-warning-500/25' },
  hold: { text: 'text-text-muted', bg: 'bg-surface', border: 'border-border-strong' },
};

export function ActionPermissions() {
  return (
    <section className="bg-panel border border-border-subtle rounded-xl p-6 h-full flex flex-col">
      <div className="flex items-start justify-between mb-5 gap-3">
        <div>
          <h3 className="text-text-primary text-[15px] font-semibold">Autonomous Recovery Actions</h3>
          <p className="text-[12px] text-text-muted mt-1">What REVORA may execute on its own, per recovery action.</p>
        </div>
        <span className="text-[9.5px] font-mono uppercase text-text-muted bg-surface px-2 py-1 rounded border border-border-subtle tracking-wider shrink-0 whitespace-nowrap">
          Closed actions
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 flex-1">
        {PERMISSIONS.map((p) => {
          const Icon = p.icon;
          const style = MODE_STYLE[p.mode];
          return (
            <div
              key={p.action}
              className="flex flex-col gap-2 p-3 rounded-lg bg-surface border border-border-subtle hover:border-border-strong transition-colors min-w-0"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Icon className="w-3.5 h-3.5 text-text-secondary shrink-0" strokeWidth={1.75} />
                <span className="text-[11.5px] font-medium text-text-primary leading-snug">{ACTION_LABEL[p.action]}</span>
              </div>
              <span className={`self-start text-[9px] font-medium px-1.5 py-0.5 rounded border leading-tight ${style.text} ${style.bg} ${style.border}`}>
                {p.badge}
              </span>
              <p className="text-[10.5px] text-text-secondary leading-snug">{p.condition}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
