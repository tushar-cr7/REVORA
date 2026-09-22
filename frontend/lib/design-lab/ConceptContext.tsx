'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Concept } from './conceptMeta';

// Server Components must import CONCEPT_META / SCREEN_SLUGS directly from
// './conceptMeta' (plain data, no 'use client') — re-exporting them through
// this client module would make them opaque to server-side rendering.
export type { Concept } from './conceptMeta';

const STORAGE_KEY = 'revora-design-lab-concept';

interface ConceptContextValue {
  concept: Concept;
  setConcept: (c: Concept) => void;
}

const ConceptCtx = createContext<ConceptContextValue>({ concept: 'a', setConcept: () => {} });

export function ConceptProvider({ children }: { children: React.ReactNode }) {
  const [concept, setConceptState] = useState<Concept>('a');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'a' || stored === 'b' || stored === 'c') setConceptState(stored);
    } catch {
      // ignore — localStorage may be unavailable (private mode, etc.)
    }
  }, []);

  const setConcept = (c: Concept) => {
    setConceptState(c);
    try {
      window.localStorage.setItem(STORAGE_KEY, c);
    } catch {
      // ignore
    }
  };

  return <ConceptCtx.Provider value={{ concept, setConcept }}>{children}</ConceptCtx.Provider>;
}

export function useConcept() {
  return useContext(ConceptCtx);
}
