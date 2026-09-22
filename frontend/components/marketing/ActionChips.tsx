import React from 'react';
import { RefreshCw, Link2, BellRing, ArrowUpCircle, PauseCircle } from 'lucide-react';
import { Reveal } from './Reveal';

const ACTIONS = [
  { name: 'Retry', key: 'retry', icon: RefreshCw, desc: 'Re-attempt a failed charge within retry and cooldown limits.' },
  { name: 'Payment Link', key: 'payment_link', icon: Link2, desc: 'Send a fresh, trackable link to complete payment.' },
  { name: 'Reminder', key: 'reminder', icon: BellRing, desc: 'A single, rate-limited nudge for an abandoned or overdue case.' },
  { name: 'Escalate', key: 'escalate', icon: ArrowUpCircle, desc: 'Route high-value or borderline cases to human review.' },
  { name: 'Suppress', key: 'suppress', icon: PauseCircle, desc: 'A deliberate no-action — recognized as a correct outcome, not a gap.', highlight: true },
];

export function ActionChips() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {ACTIONS.map((action, i) => (
        <Reveal key={action.key} delay={i * 0.05}>
          <div
            className={
              action.highlight
                ? 'flex h-full flex-col gap-3 rounded-lg border border-accent-300 bg-accent-100/60 p-5'
                : 'flex h-full flex-col gap-3 rounded-lg border border-hairline bg-paper-raised p-5'
            }
          >
            <action.icon size={18} strokeWidth={1.75} className="text-ink" />
            <div>
              <div className="text-sm font-semibold text-ink">{action.name}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{action.desc}</p>
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
