'use client';

import { useCallback, useState } from 'react';
import { useRouteTransition } from './transition-context';

/**
 * Shared click behavior for every "Open Dashboard" entry point on the
 * marketing site: gives instant visual feedback, blocks duplicate clicks
 * while navigation is in flight, and kicks off the branded transition field
 * from wherever the user actually clicked.
 */
export function useDashboardEntry() {
  const [pending, setPending] = useState(false);
  const { start } = useRouteTransition();

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (pending) {
        e.preventDefault();
        return;
      }
      setPending(true);
      // Keyboard-activated clicks report (0, 0); fall back to viewport
      // center in that case rather than anchoring the field to a corner.
      const hasPointerOrigin = e.clientX !== 0 || e.clientY !== 0;
      start(hasPointerOrigin ? { x: e.clientX, y: e.clientY } : undefined);
    },
    [pending, start]
  );

  return { pending, onClick };
}
