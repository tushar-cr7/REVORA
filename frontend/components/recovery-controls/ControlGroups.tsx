'use client';

import React from 'react';
import { RotateCw, MessageCircle, CircleAlert, Gauge, RefreshCw } from 'lucide-react';
import { PolicyLimits } from '@/lib/types';
import { formatINR } from '@/lib/format';

interface ControlRow {
  key: keyof PolicyLimits;
  label: string;
  sentence: string;
  value: string;
}

type GroupTone = 'primary' | 'warning' | 'success';

interface ControlGroup {
  key: string;
  title: string;
  description: string;
  icon: React.ElementType;
  tone: GroupTone;
  headline?: string;
  rows: ControlRow[];
}

const TONE_BADGE: Record<GroupTone, string> = {
  primary: 'text-primary-300 border-primary-500/30 bg-primary-muted/40',
  warning: 'text-warning-300 border-warning-500/30 bg-warning-muted/40',
  success: 'text-success-300 border-success-500/30 bg-success-muted/40',
};

function buildGroups(policy: PolicyLimits): ControlGroup[] {
  return [
    {
      key: 'action-limits',
      title: 'Action Limits',
      description: 'How often and how far REVORA can act on one case.',
      icon: RotateCw,
      tone: 'primary',
      rows: [
        {
          key: 'max_retries',
          label: 'Retry limit',
          sentence: `Maximum ${policy.max_retries} recovery attempts per transaction.`,
          value: `${policy.max_retries} attempts`,
        },
        {
          key: 'min_cooldown_hours',
          label: 'Cooldown',
          sentence: `Wait ${policy.min_cooldown_hours} hours before another attempt.`,
          value: `${policy.min_cooldown_hours}h`,
        },
      ],
    },
    {
      key: 'customer-contact',
      title: 'Customer Contact',
      description: 'How often a customer can be reached about a recovery case.',
      icon: MessageCircle,
      tone: 'primary',
      rows: [
        {
          key: 'max_customer_contacts_per_day',
          label: 'Contact frequency',
          sentence: `Maximum ${policy.max_customer_contacts_per_day} contact per customer per day.`,
          value: `${policy.max_customer_contacts_per_day} / day`,
        },
      ],
    },
    {
      key: 'escalation',
      title: 'Escalation',
      description: 'When a case is handed back to you instead of retried automatically.',
      icon: CircleAlert,
      tone: 'warning',
      rows: [
        {
          key: 'max_subscription_consecutive_failures_for_retry',
          label: 'Subscription failure threshold',
          sentence: `Escalate after more than ${policy.max_subscription_consecutive_failures_for_retry} consecutive subscription failures.`,
          value: `${policy.max_subscription_consecutive_failures_for_retry} failures`,
        },
        {
          key: 'invoice_escalation_age_days',
          label: 'Invoice age',
          sentence: `Escalate overdue invoices older than ${policy.invoice_escalation_age_days} days.`,
          value: `${policy.invoice_escalation_age_days}d`,
        },
      ],
    },
    {
      key: 'risk-boundaries',
      title: 'Risk Boundaries',
      description: 'Financial ceiling that prevents excessive autonomous action.',
      icon: Gauge,
      tone: 'success',
      headline: formatINR(policy.max_auto_recovery_value),
      rows: [
        {
          key: 'max_auto_recovery_value',
          label: 'Autonomous recovery ceiling',
          sentence: `Up to ${formatINR(policy.max_auto_recovery_value)} per recovery action. Above this, REVORA escalates instead.`,
          value: formatINR(policy.max_auto_recovery_value),
        },
      ],
    },
  ];
}

interface ControlGroupsProps {
  policy: PolicyLimits | null;
  loading: boolean;
  error: boolean;
}

export function ControlGroups({ policy, loading, error }: ControlGroupsProps) {
  if (loading && !policy) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="bg-panel border border-border-strong rounded-xl p-5 h-40 flex items-center justify-center">
            <RefreshCw className="w-4 h-4 text-text-muted animate-spin" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="bg-panel border border-border-strong rounded-xl p-6 text-[13px] text-text-muted text-center">
        Recovery controls could not be loaded from the backend.
      </div>
    );
  }

  const groups = buildGroups(policy);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {groups.map((group) => {
        const Icon = group.icon;
        return (
          <div key={group.key} className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm flex flex-col min-w-0">
            <div className="flex items-start justify-between gap-2 pb-3 mb-3 border-b border-border-subtle flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${TONE_BADGE[group.tone]}`}>
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary leading-snug">{group.title}</span>
              </div>
              {group.headline && (
                <span className="text-[11px] font-mono font-semibold text-success-300 bg-success-muted/40 border border-success-500/25 rounded px-2 py-0.5 shrink-0 whitespace-nowrap">
                  {group.headline}
                </span>
              )}
            </div>
            <p className="text-[11.5px] text-text-muted mb-4 leading-relaxed">{group.description}</p>

            <div className="space-y-4 mt-auto">
              {group.rows.map((row) => (
                <div key={row.key} className="min-w-0">
                  <div className="flex items-start justify-between gap-x-3 gap-y-1 flex-wrap">
                    <div className="text-[13px] font-medium text-text-primary min-w-0">{row.label}</div>
                    <span className="text-[12px] font-mono font-semibold text-primary-400 bg-primary-900/10 border border-primary-500/20 rounded px-2 py-0.5 shrink-0 whitespace-nowrap">
                      {row.value}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-text-secondary mt-1 leading-relaxed">{row.sentence}</p>
                  <p className="text-[10px] font-mono text-text-disabled mt-1 break-all">{row.key}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
