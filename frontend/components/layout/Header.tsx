'use client';

import React from 'react';
import { RefreshCw, Bell, Sparkles } from 'lucide-react';
import { RevoraLogo } from '@/components/brand/RevoraLogo';

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
    <header className="h-14 bg-surface/95 backdrop-blur-sm border-b border-border-subtle px-5 flex items-center justify-between sticky top-0 z-30">
      {/* Brand & Context */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-3.5">
          <RevoraLogo variant="mark" width={26} height={26} />
          <div className="h-5 w-px bg-border-subtle hidden sm:block" />
          <div className="hidden sm:flex flex-col justify-center gap-1">
            <h1 className="text-text-primary font-semibold text-[14px] tracking-[-0.015em] leading-none">
              Revenue Command
            </h1>
            <p className="rv-label leading-none">
              Northstar Commerce
            </p>
          </div>
        </div>

        {/* System state: a status read-out, not a decoration */}
        <div className="hidden md:flex items-center gap-2 h-6 pl-2 pr-2.5 rounded-sm bg-success-500/[0.07] border border-success-500/20">
          <span className="rv-dot" data-tone="success" data-live />
          <span className="font-mono text-[10px] font-medium tracking-[0.12em] uppercase text-success-300">
            System active
          </span>
        </div>
      </div>

      {/* Actions & User Control */}
      <div className="flex items-center gap-2">
        {/* Below `sm` the labels collapse (icon-only Scan, short Analyze) so the
            whole control cluster fits a phone-width header. */}
        <button
          onClick={onScan}
          disabled={isScanning}
          aria-label="Scan Revenue"
          className="rv-btn rv-btn-secondary"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-primary-300' : 'text-text-secondary'}`} strokeWidth={1.75} />
          <span className="hidden sm:inline">{isScanning ? 'Scanning…' : 'Scan Revenue'}</span>
        </button>

        <button
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className="rv-btn rv-btn-primary"
        >
          <Sparkles className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          <span>
            {isAnalyzing ? 'Analyzing…' : (
              <>
                Analyze<span className="hidden sm:inline"> Intelligence</span>
              </>
            )}
          </span>
        </button>

        <div className="h-5 w-px bg-border-subtle mx-1.5 hidden sm:block" />

        <button
          aria-label="Notifications"
          className="relative w-8 h-8 inline-flex items-center justify-center rounded-md border border-transparent hover:border-border-subtle hover:bg-panel text-text-muted hover:text-text-primary transition-colors"
        >
          <Bell className="w-4 h-4" strokeWidth={1.75} />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary-500 ring-2 ring-surface" />
        </button>

        <button
          aria-label="Account"
          className="w-8 h-8 rounded-md bg-panel-raised border border-border-strong flex items-center justify-center hover:border-text-disabled transition-colors"
        >
          <span className="font-mono text-[11px] font-medium text-text-secondary">NC</span>
        </button>
      </div>
    </header>
  );
};
