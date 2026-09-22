'use client';

import React from 'react';
import { RefreshCw, Bell, ChevronDown, Sparkles } from 'lucide-react';
import { RevoraLogo } from '@/components/brand/RevoraLogo';
import { motion } from 'framer-motion';

interface HeaderProps {
  onScan: () => void;
  onAnalyze: () => void;
  isScanning: boolean;
  isAnalyzing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onScan,
  onAnalyze,
  isScanning,
  isAnalyzing,
}) => {
  return (
    <header className="h-16 bg-surface/80 backdrop-blur-md border-b border-border-subtle px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Brand & Context */}
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-4">
          <RevoraLogo variant="mark" width={28} height={28} />
          <div className="h-4 w-px bg-border-strong hidden sm:block" />
          <div className="hidden sm:flex flex-col justify-center">
            <h1 className="text-text-primary font-medium text-[15px] tracking-tight leading-none mb-1">
              Revenue Command
            </h1>
            <p className="text-text-muted text-[11px] uppercase tracking-wider font-mono leading-none">
              NORTHSTAR COMMERCE
            </p>
          </div>
        </div>

        <div className="h-5 w-px bg-border-divider hidden md:block" />

        {/* Live System Indicator */}
        <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-success-muted border border-success-500/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success-500"></span>
          </span>
          <span className="text-success-500 text-[11px] font-mono font-medium tracking-wide">SYSTEM ACTIVE</span>
        </div>
      </div>

      {/* Actions & User Control */}
      <div className="flex items-center space-x-3">
        {/* Run Scan Button */}
        <button
          onClick={onScan}
          disabled={isScanning}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-md bg-panel hover:bg-panel-hover border border-border-strong text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-primary-300' : ''}`} />
          <span className="text-[13px] font-medium">{isScanning ? 'Scanning...' : 'Scan Revenue'}</span>
        </button>

        {/* Analyze Risk Button */}
        <button
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className="flex items-center space-x-2 px-4 py-1.5 rounded-md bg-ai-600 hover:bg-ai-500 text-white shadow-sm transition-colors disabled:opacity-50"
        >
          <Sparkles className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
          <span className="text-[13px] font-medium">{isAnalyzing ? 'Analyzing...' : 'Analyze Intelligence'}</span>
        </button>

        <div className="h-5 w-px bg-border-divider mx-1" />

        {/* Notifications Bell */}
        <button className="p-2 rounded-md hover:bg-panel border border-transparent hover:border-border-subtle text-text-muted hover:text-text-primary transition-colors relative">
          <Bell className="w-4 h-4" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-ai-500 ring-2 ring-surface" />
        </button>
        
        {/* Profile */}
        <button className="w-8 h-8 rounded-full bg-panel border border-border-strong flex items-center justify-center overflow-hidden hover:border-primary-500 transition-colors">
          <span className="text-xs font-medium text-text-secondary">NC</span>
        </button>
      </div>
    </header>
  );
};
