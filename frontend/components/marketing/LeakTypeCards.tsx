import React from 'react';
import { CreditCard, MousePointerClick, RotateCcw, FileClock } from 'lucide-react';
import { Reveal } from './Reveal';

const LEAKS = [
  { title: 'Failed payment', icon: CreditCard, desc: 'A card declines and the revenue simply stops moving.' },
  { title: 'Abandoned checkout', icon: MousePointerClick, desc: 'Intent was real — the customer reached checkout and left.' },
  { title: 'Failed subscription', icon: RotateCcw, desc: 'A recurring renewal fails silently in the background.' },
  { title: 'Overdue invoice', icon: FileClock, desc: 'An invoice ages past due with no automatic follow-up.' },
];

export function LeakTypeCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {LEAKS.map((leak, i) => (
        <Reveal key={leak.title} delay={i * 0.06}>
          <div className="flex h-full flex-col gap-4 rounded-lg border border-hairline bg-paper-raised p-6">
            <leak.icon size={20} strokeWidth={1.5} className="text-ink" />
            <div>
              <div className="font-display text-lg text-ink">{leak.title}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{leak.desc}</p>
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
