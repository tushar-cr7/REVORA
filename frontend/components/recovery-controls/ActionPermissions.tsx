'use client';

import React from 'react';
import { RotateCcw, Link2, Bell, UserCheck, PauseCircle } from 'lucide-react';
import { ACTION_LABEL, ACTION_PREVIEW } from '@/lib/actionMeta';

type PermissionMode = 'automatic' | 'review' | 'hold';

interface ActionPermission {
  action: keyof typeof ACTION_LABEL;
  icon: React.ElementType;
  mode: PermissionMode;
  badge: string;
  condition: string;
}

/**
 * One row per real Action enum value (backend/app/domain/models.py).
 * "mode" and "condition" reflect the actual reroute rules in
 * evaluate_policy() (backend/app/domain/policy.py) — not invented
 * capabilities. Escalate and suppress are never themselves blocked by
 * policy; they are the reroute targets other actions fall back to.
 */
const PERMISSIONS: ActionPermission[] = [
  {
    action: 'retry',
    icon: RotateCcw,
    mode: 'automatic',
    badge: 'Automatic within limits',
    condition: 'Runs on its own — within the retry limit, cooldown, and subscription health checks.',
  },
  {
    action: 'payment_link',
    icon: Link2,
    mode: 'automatic',
    badge: 'Automatic within limits',
    condition: 'Sent on its own — within the customer contact frequency and value ceiling.',
  },
  {
    action: 'reminder',
    icon: Bell,
    mode: 'automatic',
    badge: 'Automatic within limits',
    condition: 'Sent on its own — within the contact frequency, value ceiling, and invoice age checks.',
  },
  {
    action: 'escalate',
    icon: UserCheck,
    mode: 'review',
    badge: 'Always reviewed',
    condition: 'Always handed to you — REVORA never resolves this on its own.',
  },
  {
    action: 'suppress',
    icon: PauseCircle,
    mode: 'hold',
    badge: 'Automatic hold',
    condition: 'A deliberate no-action taken when a contact or cooldown limit has been reached.',
  },
];

const MODE_STYLE: Record<PermissionMode, { text: string; bg: string; border: string }> = {
  automatic: { text: 'text-success-500', bg: 'bg-success-500/10', border: 'border-success-500/25' },
  review: { text: 'text-warning-500', bg: 'bg-warning-500/10', border: 'border-warning-500/25' },
  hold: { text: 'text-text-muted', bg: 'bg-surface', border: 'border-border-strong' },
};

export function ActionPermissions() {
  return (
    <div className="bg-panel border border-border-strong rounded-xl p-6 shadow-sm">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-text-primary text-[15px] font-semibold">Autonomous Recovery</h3>
          <p className="text-[12px] text-text-muted mt-1">What REVORA may execute on its own, per recovery action.</p>
        </div>
        <span className="text-[10px] font-mono uppercase text-text-muted bg-surface px-2 py-0.5 rounded border border-border-subtle tracking-wider shrink-0">
          Closed action set
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {PERMISSIONS.map((p) => {
          const Icon = p.icon;
          const style = MODE_STYLE[p.mode];
          return (
            <div
              key={p.action}
              className="flex flex-col gap-2.5 p-4 rounded-lg bg-surface border border-border-subtle hover:border-border-strong transition-colors"
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-text-secondary shrink-0" />
                <span className="text-[13px] font-medium text-text-primary">{ACTION_LABEL[p.action]}</span>
              </div>
              <span className={`self-start text-[10.5px] font-medium px-2 py-0.5 rounded border ${style.text} ${style.bg} ${style.border}`}>
                {p.badge}
              </span>
              <p className="text-[11.5px] text-text-secondary leading-relaxed">{p.condition}</p>
              <p className="text-[11px] text-text-muted leading-relaxed border-t border-border-subtle pt-2 mt-auto">
                {ACTION_PREVIEW[p.action]}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
