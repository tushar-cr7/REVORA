// Plain data — deliberately NOT in a 'use client' file, so Server Components
// (the landing page, concept-switcher labels rendered server-side, etc.) can
// read it directly without the "dot into a client module" RSC restriction.

export type Concept = 'a' | 'b' | 'c';

export const CONCEPT_META: Record<Concept, { name: string; tagline: string }> = {
  a: { name: 'Financial Command Center', tagline: 'Premium institutional fintech' },
  b: { name: 'Modern Revenue OS', tagline: 'Editorial, fluid, contextual' },
  c: { name: 'Revenue Control Room', tagline: 'Dense operational command center' },
};

/** The exact route slug list every concept implements identically, so the switcher can jump to the equivalent screen. */
export const SCREEN_SLUGS = [
  '',
  '/scanner',
  '/opportunities',
  '/transactions',
  '/activity',
  '/attention',
  '/controls',
  '/audit',
  '/analytics',
  '/decisions',
  '/copilot',
  '/integrations',
  '/settings',
] as const;
