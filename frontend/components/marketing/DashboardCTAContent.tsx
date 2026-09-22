'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

/**
 * Shared click-response content for every "Open Dashboard" entry point.
 * Renders inside a `relative overflow-hidden` Link. On click: a brief
 * physical compression (not a bounce), a single pass of internal light
 * sweeping through the button, and the label resolving to "Opening
 * Revenue Command" — the click reads as acknowledged immediately.
 */
export function DashboardCTAContent({
  pending,
  children,
  icon,
}: {
  pending: boolean;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <>
      {pending && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-transparent via-white/35 to-transparent"
          initial={{ x: '-140%' }}
          animate={{ x: '340%' }}
          transition={{ duration: 0.55, ease: 'easeInOut' }}
        />
      )}
      <motion.span
        className="relative inline-flex items-center gap-2"
        animate={pending ? { scale: [1, 0.96, 1] } : { scale: 1 }}
        transition={{ duration: 0.3, ease: [0.34, 1.2, 0.4, 1] }}
      >
        {pending ? (
          <>
            <Loader2 size={15} className="animate-spin" aria-hidden />
            <span>Opening Revenue Command</span>
          </>
        ) : (
          <>
            <span>{children}</span>
            {icon}
          </>
        )}
      </motion.span>
    </>
  );
}
