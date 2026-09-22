'use client';

import React, { useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { api } from '@/lib/api';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleScan = useCallback(async () => {
    setIsScanning(true);
    try {
      await api.scanRevenue(100, 42);
      await api.analyzeRevenue();
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      await api.analyzeRevenue();
    } catch (err) {
      console.error('Analyze error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const reduceMotion = useReducedMotion();

  return (
    <div className="min-h-screen bg-canvas text-text-primary flex flex-col">
      <motion.div
        className="w-full"
        initial={reduceMotion ? undefined : { opacity: 0, y: -10 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <Header
          onScan={handleScan}
          onAnalyze={handleAnalyze}
          isScanning={isScanning}
          isAnalyzing={isAnalyzing}
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
