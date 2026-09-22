'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ENTER_MIN_MS } from './transition-timing';

interface Origin {
  x: number;
  y: number;
}

interface TransitionContextValue {
  active: boolean;
  origin: Origin | null;
  start: (origin?: Origin) => void;
}

const TransitionContext = createContext<TransitionContextValue>({
  active: false,
  origin: null,
  start: () => {},
});

export function useRouteTransition() {
  return useContext(TransitionContext);
}

// Safety net only — never lets a stalled/failed navigation leave the field
// on screen indefinitely. Not a deliberate delay on the happy path.
const SAFETY_MAX_MS = 5000;

/**
 * Lives in the root layout so it survives the swap between the (marketing)
 * and (dashboard) route groups — that's what lets the transition bridge the
 * light landing page and the dark dashboard shell instead of remounting
 * (and flashing) with the page.
 */
export function TransitionProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const pathname = usePathname();
  const startedAtRef = useRef<number | null>(null);

  const start = useCallback((o?: Origin) => {
    startedAtRef.current = Date.now();
    setOrigin(o ?? null);
    setActive(true);
  }, []);

  // Once the target route has committed, hold the overlay just long enough
  // to finish its own entrance, then release it — the dashboard underneath
  // (already dark) takes over seamlessly.
  useEffect(() => {
    if (!active) return;
    const elapsed = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
    const t = setTimeout(() => setActive(false), Math.max(0, ENTER_MIN_MS - elapsed));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(false), SAFETY_MAX_MS);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <TransitionContext.Provider value={{ active, origin, start }}>
      {children}
    </TransitionContext.Provider>
  );
}
