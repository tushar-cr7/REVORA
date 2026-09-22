/**
 * Shared choreography for the landing -> Revenue Command transition
 * ("The Resolve" — see RouteTransitionOverlay.tsx for the concept).
 * Centralized so the provider's hold-timer and the overlay's own
 * animations can never drift out of sync.
 *
 * All values are seconds unless noted, measured from the moment the user
 * clicks. Tuned for the fast/warm-route case — a slow route is handled
 * separately by the provider's pathname-driven release, not by these
 * constants.
 */

export const IRIS_DELAY = 0.08;
export const IRIS_DURATION = 0.52; // the environment fully commits to dark at ~0.60s

export const SHARD_BASE_DELAY = 0.14;
export const SHARD_STAGGER = 0.03;
export const SHARD_DURATION = 0.32;
export const SHARD_LOCK_T = SHARD_BASE_DELAY + SHARD_STAGGER * 3 + SHARD_DURATION; // ~0.55s, all four shards seated

export const WORDMARK_LIGHT_AT = 0.46; // dark-on-light wordmark, while the backdrop is still mostly light
export const WORDMARK_CROSSFADE_AT = 0.58; // crosses to the light-on-dark asset right as the iris finishes closing
export const WORDMARK_CROSSFADE_DURATION = 0.14; // resolved by ~0.72s

export const PULSE_AT = SHARD_LOCK_T; // one-shot arrival settle, plays once when the mark locks
export const BREATH_DELAY = 0.9; // only reached if the route is genuinely still loading — a barely-there "standing by" signal

// Provider holds the overlay at least this long — enough for the mark to
// resolve and hold for a beat — before it's allowed to release. This is a
// FLOOR, not a fixed wait: on a slow route the provider still only releases
// once the route has actually committed (see transition-context.tsx), so a
// slow load never gets cut short and a fast one never waits longer than this.
export const ENTER_MIN_MS = 880;

// The mark's own fade-out is driven directly by the `active` flag (see
// MarkResolve in RouteTransitionOverlay.tsx), not by a fixed delay — so it
// only ever starts once release has actually happened, never before the
// route is ready. It's deliberately faster than the field's own exit fade
// below so the mark is fully gone before the field becomes transparent
// enough to reveal what's under it — otherwise the resolved mark visibly
// ghosts over the now-visible dashboard for the duration of the overlap.
export const MARK_EXIT_DURATION = 0.09;
export const FIELD_EXIT_DURATION = 0.24;

// How long the overlay stays mounted (rendering, just invisible) after
// release before it's actually removed from the tree. Must be >= the
// longest of the two exit fades above, with a little slack — long enough
// that both fades can finish while children can still see `active: false`
// and react to it (see the note on MarkResolve below for why that matters).
export const EXIT_UNMOUNT_BUFFER_MS = 320;

export const EASE_ARRIVE = [0.16, 1, 0.3, 1] as const; // objects settling into place — mark shards, wordmark
export const EASE_CLOSE = [0.65, 0, 0.35, 1] as const; // the iris mechanism itself — deliberate, mechanical
