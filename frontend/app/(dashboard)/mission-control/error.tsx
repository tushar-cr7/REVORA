'use client';

import React, { useEffect } from 'react';
import { RevoraLogo } from '@/components/brand/RevoraLogo';

export default function MissionControlError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Mission Control failed to load:', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <RevoraLogo variant="mark" width={36} height={36} />
      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-muted">
          Revenue Command
        </p>
        <h2 className="mt-1.5 text-lg font-semibold text-text-primary">Unable to open workspace</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Something interrupted the connection. Your data is safe.
        </p>
      </div>
      <button
        onClick={() => reset()}
        className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
      >
        Try again
      </button>
    </div>
  );
}
