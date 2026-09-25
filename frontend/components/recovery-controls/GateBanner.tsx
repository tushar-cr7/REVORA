'use client';

import React from 'react';
import { ShieldCheck } from 'lucide-react';

/** Full-width statement beneath the two-column signature section. */
export function GateBanner() {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-5 py-4 flex items-center justify-center gap-3 text-center">
      <ShieldCheck className="w-4 h-4 text-primary-300 shrink-0" strokeWidth={1.75} />
      <p className="text-[12.5px] text-text-secondary leading-relaxed">
        <span className="text-text-primary font-medium">Every action passes through this gate.</span>{' '}
        The gate is fixed. It can be tightened by you, but it cannot be talked around by the AI.
      </p>
    </div>
  );
}
