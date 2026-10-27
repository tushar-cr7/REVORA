'use client';

import React, { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  // The header's Scan/Analyze actions hand off to the pages already built
  // to run and show these workflows for real — Revenue Scanner owns the
  // actual scan (with its own trigger, live state machine, and results),
  // Recovery Brain owns the actual intelligence pass. Firing the same API
  // calls again here in the background, with no page listening for the
  // result, is what made these buttons look like they did nothing.
  const handleScan = useCallback(() => {
    router.push('/revenue-scanner');
  }, [router]);

  const handleAnalyze = useCallback(() => {
    router.push('/recovery-brain');
  }, [router]);

  const reduceMotion = useReducedMotion();

  return (
    <div className="rv-app isolate relative min-h-screen bg-canvas text-text-primary flex flex-col">
      <div aria-hidden className="rv-backdrop" />
      <motion.div
        className="w-full"
        initial={reduceMotion ? undefined : { opacity: 0, y: -10 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <Header
          onScan={handleScan}
          onAnalyze={handleAnalyze}
          isScanning={false}
          isAnalyzing={false}
        />
      </motion.div>
      <motion.div
        className="flex-1 flex overflow-hidden"
        initial={reduceMotion ? undefined : { opacity: 0 }}
        animate={reduceMotion ? undefined : { opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
      >
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </motion.div>
    </div>
  );
}
