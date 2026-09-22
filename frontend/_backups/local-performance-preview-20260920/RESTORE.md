# Local startup / dashboard performance fix — rollback backup

Taken 2026-09-20, before fixing the local-dev startup and Landing ->
Dashboard performance problem (frontend/backend code only — no UI
redesign, no backend business-logic changes, no API contract changes).

## To restore ("NAHH — RESTORE")

Copy the files below back to their original paths.

| Backup path | Restore to |
|---|---|
| `root/run.bat` | `run.bat` |
| `app/(dashboard)/mission-control/page.tsx` | `frontend/app/(dashboard)/mission-control/page.tsx` |

Then delete the new file this round adds (it did not exist before):

- `warmup.ps1` (repo root)

No other files were changed. `backend/app/domain/policy.py`,
`backend/app/intelligence/*`, and every other backend module are untouched.
No `next.config.js` was added — see the "Things measured and rejected"
section below for why.

## Diagnosis (measured, not assumed)

Every number below is a real measurement taken against the running app on
this machine, not an estimate.

1. **"Open Dashboard" does not block on the animation.** Read
   `lib/use-dashboard-entry.ts`, `lib/transition-context.tsx`, and
   `components/transition/RouteTransitionOverlay.tsx` end to end: the
   `<Link>` navigation fires immediately on click (nothing calls
   `preventDefault()` on the real navigation), and the branded overlay's
   own choreography is a fixed, short ~0.7-0.9s sequence. The overlay only
   *stays visible* longer than that because it waits for `usePathname()` to
   change before releasing, and in dev mode `usePathname()` doesn't update
   until Next has actually compiled and returned the target route. So the
   overlay was never the bottleneck — it was accurately reporting how long
   the real navigation was taking underneath it. This is exactly the
   "breathing loop... if the actual route is slow" case the component's own
   comments already anticipated. **Not changed.**

2. **Next.js dev-mode on-demand route compilation is the dominant cost.**
   Measured via direct `curl` timing (bypassing the browser/animation
   entirely) against a freshly started `next dev` process:
   - First request to `/` (landing): **1.9s-3.2s** depending on how warm
     the on-disk webpack cache already was (1369-1401 modules).
   - First request to `/mission-control`: **0.86s-2.7s** (1508-1522
     modules).
   - Second request to either route (already compiled): **0.08-0.24s.**
   - A truly cold run (`.next` deleted entirely, simulating a fresh clone)
     was worse: **~6.1s** for `/`, **~4.5s** for `/mission-control`.

   This one-time-per-process compile is what the user experiences as "the
   dashboard takes another 5-10 seconds to appear" — the branded overlay
   sits there (by design) until this finishes.

3. **The dashboard's own boot sequence double-fires every request in dev.**
   Captured actual network traffic on a single fresh load of
   `/mission-control` with Playwright: `POST /api/scan`,
   `POST /api/analyze`, and all four parallel reads
   (`/api/opportunities`, `/api/audit`, `/api/policies`,
   `/api/escalations`) each fired **twice**, milliseconds apart — 12
   requests instead of 6. This is React's Strict-Mode dev-only
   double-invoke of `useEffect` acting on the boot effect in
   `mission-control/page.tsx`, which had no guard against it. It roughly
   doubles the real backend work (a fresh synthetic scan + a full decision
   engine + policy pass, twice) done on every single dashboard load in dev.

4. **Backend cold start is ~2.4-4s, almost entirely Python import cost.**
   Timed `pandas`/`xgboost`/`fastapi` imports directly:
   `pandas 0.65s + xgboost 1.38s + fastapi 0.35s ≈ 2.4s`, plus uvicorn/ASGI
   boot, landing around 3-4s total to `/api/health` responding. The trained
   model itself loads from the cached `backend/recovery_model.joblib` (fast
   `joblib.load`, not a retrain) — this cost is inherent to the ML
   dependencies REVORA's real decision engine uses, not a bug, and is out
   of scope to remove (backend business logic). Because `run.bat` starts
   backend and frontend as two independent `start` windows already (not
   sequentially), this ~3-4s already overlaps with frontend startup — but
   the dashboard's boot effect had no tolerance for the case where the
   frontend becomes interactive slightly before the backend finishes
   booting: `initBoot`'s only failure handling was to show a static
   "Connecting to REVORA backend..." error with no retry, which would sit
   there until a manual page refresh.

5. **The four independent reads in `loadBackendData` were already
   correctly parallelized** (`Promise.all` over opportunities/audit/
   policies/escalations, each with its own `.catch` fallback) — no change
   needed there. The `scan -> analyze` sequence is a genuine backend data
   dependency (`analyze` reads the transactions `scan` just created) and
   cannot be safely parallelized — measured combined cost is small anyway
   (~0.5-0.8s over direct backend calls).

## Things measured and rejected (kept out of the final change)

- **Turbopack (`next dev --turbo`)**: measured cold-compile of `/` got
  *worse* (5.5s vs 3.2s) while `/mission-control` got better (1.4s vs
  2.7s) — a wash on the full landing-to-dashboard journey, on top of being
  a beta dev-mode feature in Next 14.2. Not adopted.
- **`experimental.optimizePackageImports` for `lucide-react`/
  `framer-motion`**: tested with a real `next.config.js` and a true cold
  `.next` deletion for a fair before/after. Module count dropped ~13-14%
  but wall-clock compile time did not improve (6.8s vs 6.1s for `/`, 5.2s
  vs 4.5s for `/mission-control` — noise-level, not a real win). Not
  adopted; no `next.config.js` was added.
- **Splitting `mission-control`'s child components into `next/dynamic`
  imports**: the module-count delta between the landing route (1401) and
  the dashboard route (1522) is only ~120 modules — most of the ~1.4-6s
  compile cost is shared framework/vendor compilation paid once per
  process, not weight specific to this page's own components. Lazy-loading
  them would add real complexity for a small, unmeasured slice of the
  total cost, so it was not done.

## What this round actually changed

1. **`warmup.ps1`** (new, repo root) — polls `http://localhost:3000/`
   every 500ms until the frontend responds, then makes one request to
   `/mission-control`. A plain HTTP GET only triggers Next's server-side
   compile for that route; it does not run the dashboard's client-side
   `useEffect`/data-fetch (that code only executes inside a real browser),
   so this cannot cause an extra scan/analyze cycle on the backend.

2. **`run.bat`** — after launching the existing backend and frontend
   windows exactly as before, launches a third, minimized, self-closing
   window that runs `warmup.ps1` in the background. Backend startup,
   frontend startup, the two visible console windows, and the final
   `pause` prompt are all unchanged — this only adds a background step
   that finishes on its own with nothing left to clean up.

3. **`frontend/app/(dashboard)/mission-control/page.tsx`** — the boot
   `useEffect`:
   - Gained a `hasBootedRef` guard so React Strict Mode's dev-only
     double-invoke can no longer fire the scan/analyze/read sequence
     twice. Verified with the same Playwright network capture used in
     diagnosis step 3 — see the AFTER measurement below.
   - The boot call is now retried up to 5 times, 700ms apart, but *only*
     when the request throws (a connection failure — the backend isn't
     listening yet), never on an actual API error response. This covers
     exactly the backend cold-start race in diagnosis step 4 without
     adding any delay on the common case where the backend is already up.
   - No visual, animation, or API contract change. Rendering logic, JSX,
     and all child component props are untouched.

## Before / after (measured on this machine, this session)

BEFORE (existing code, dev caches at realistic everyday-restart warmth):
- Frontend port listening: ~2s after `run.bat`
- Backend `/api/health` responding: ~5-6s after `run.bat` (pandas +
  xgboost + fastapi import chain measured directly at ~2.4s, plus
  uvicorn/ASGI boot)
- First visit to `/`: 1.9-3.2s (warm cache) up to ~6.1s (`.next` deleted,
  true cold)
- Click "Open Dashboard" -> `/mission-control` compiled + rendered:
  0.86-2.7s (warm cache) up to ~4.5s (true cold) — the branded overlay
  stays up this whole time by design, since it waits for the real route
  to commit
- Boot sequence network calls: **12** (`scan`, `analyze`, and the 4
  parallel reads each fired twice — React Strict Mode double-invoke, no
  guard existed)
- A backend that's still mid-boot when the user clicks through produced a
  dead "Connecting to REVORA backend..." error with no retry

AFTER (this round's changes, same machine, same cache states):
- Frontend port listening: ~2s after `run.bat` (unchanged — inherent
  Next.js boot cost, not a target of this fix)
- Backend `/api/health` responding: ~5s after `run.bat` (unchanged —
  inherent Python import cost; backend business logic is out of scope)
- `warmup.ps1` finishes pre-compiling both routes ~8-10s after `run.bat`,
  in the background, before a person has typically even opened a browser
  tab
- User's actual first visit to `/`: **0.19-0.26s** (already compiled)
- Click "Open Dashboard" -> URL committed: **~635ms**; dashboard shell
  visible: **~690ms**; overlay released + data populated: **~2.1s** —
  all driven by real backend round-trips and client hydration, not dev
  compilation
- Direct navigation to `/mission-control` (no landing page involved):
  shell visible in **~250ms**, data populated in **~1.3s**
- Boot sequence network calls: **6** (verified via Playwright network
  capture — `scan`, `analyze`, `opportunities`, `audit`, `policies`,
  `escalations`, each exactly once)
- A backend that's still mid-boot now self-heals via up to 5 retries,
  700ms apart, instead of requiring a manual page refresh

## A bug introduced and fixed within this same round

The first version of the `mission-control/page.tsx` change paired the
`hasBootedRef` guard with an unmount-cancellation flag
(`let cancelled = false` + `return () => { cancelled = true }`). That
cancellation flag's cleanup fires when React Strict Mode synthetically
"unmounts" the *first* effect invocation — the one that actually started
the real boot work — even though the ref guard correctly stopped the
*second* invocation from starting a duplicate one. The result: `cancelled`
flipped `true` immediately after the first `scan` call resolved, so
`analyze` and the parallel reads never ran. Caught via the same Playwright
network capture used for verification (only 1 of the expected 6 calls
fired). Fixed by removing the cancellation flag entirely — React 18 turns
a stale `setState` from an unmounted component into a silent no-op, so the
`hasBootedRef` guard alone is sufficient and doesn't fight itself. Re-ran
the same Playwright capture afterward to confirm all 6 calls fire exactly
once (see AFTER numbers above).
