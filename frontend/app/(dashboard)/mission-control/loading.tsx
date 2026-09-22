'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { RevoraLogo } from '@/components/brand/RevoraLogo';

export default function MissionControlLoading() {
  const reduceMotion = useReducedMotion();

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[70vh] flex-col items-center justify-center gap-5 p-6"
    >
      <motion.div
        animate={reduceMotion ? undefined : { opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <RevoraLogo variant="mark" width={40} height={40} />
      </motion.div>

      <div className="text-center">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-muted">
          Revenue Command
        </p>
        <p className="mt-1.5 text-sm text-text-secondary">
          Preparing your revenue intelligence workspace&hellip;
        </p>
      </div>

      <div className="h-0.5 w-40 overflow-hidden rounded-full bg-border-subtle">
        <motion.div
          className="h-full w-1/3 rounded-full bg-primary-500"
          animate={reduceMotion ? { x: '0%' } : { x: ['-100%', '220%'] }}
          transition={{ duration: 1.1, repeat: reduceMotion ? 0 : Infinity, ease: 'easeInOut' }}
        />
      </div>

      <span className="sr-only">Opening Revenue Command, please wait</span>
    </div>
  );
}
