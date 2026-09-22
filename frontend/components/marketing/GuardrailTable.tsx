import React from 'react';
import { Reveal } from './Reveal';

const ROWS = [
  { label: 'Max retries', value: '2', detail: 'per failed transaction' },
  { label: 'Min cooldown between retries', value: '6 hrs', detail: 'no rapid-fire attempts' },
  { label: 'Max customer contacts', value: '1 / day', detail: 'reminder or payment link' },
  { label: 'Max autonomous recovery value', value: '₹25,000', detail: 'above this, no autopilot' },
  { label: 'High-value transactions', value: 'Manual review', detail: 'routed to escalation' },
];

export function GuardrailTable() {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-paper-raised">
      {ROWS.map((row, i) => (
        <Reveal key={row.label} delay={i * 0.04}>
          <div
            className={
              'flex flex-col gap-1 px-6 py-5 sm:flex-row sm:items-center sm:justify-between ' +
              (i !== ROWS.length - 1 ? 'border-b border-hairline' : '')
            }
          >
            <div>
              <div className="text-sm font-medium text-ink">{row.label}</div>
              <div className="text-xs text-ink-muted">{row.detail}</div>
            </div>
            <div className="font-mono text-base font-medium text-ink">{row.value}</div>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
