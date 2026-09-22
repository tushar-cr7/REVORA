# Interventions — Recovery Journey hero-impact refinement — rollback backup

Taken 2026-09-21, after the `interventions-command-center-preview-20260921`
round, to elevate the Recovery Journey from "a sophisticated component in
the page" to the page's visual centrepiece. Visual refinement only — the
architecture, real-data integration, interaction model and execution flow
are unchanged.

## To restore ("NAHH — RESTORE")

Copy every file below back to its original path.

| Backup path | Restore to |
|---|---|
| `components/interventions/RecoveryJourney.tsx` | `frontend/components/interventions/RecoveryJourney.tsx` |
| `components/interventions/interventionSignals.ts` | `frontend/components/interventions/interventionSignals.ts` |
| `app/(dashboard)/interventions/page.tsx` | `frontend/app/(dashboard)/interventions/page.tsx` |

**No new files were created by this round, and nothing was deleted** — so
restoring those three files fully reverts it.

Restoring this round returns the page to the state produced by
`interventions-command-center-preview-20260921`, which is itself still
pending review. It does **not** revert that earlier round.

> `git status` also shows `mission-control/page.tsx`, `policies/page.tsx`,
> `run.bat`, `warmup.ps1`, `components/recovery-controls/` and the other
> `_backups/*` folders. Those belong to earlier still-pending preview
> rounds and are not part of this one.

## What changed

### 1. The journey became one continuous stream (`RecoveryJourney.tsx`)

Previously each gap between nodes was its own small SVG, which left visible
breaks where the wave met each node. Now a single `StreamLayer` spans the
full width behind the nodes: four wave segments in a shared
`0 0 1000 140` viewBox, every one starting and ending exactly on the
centreline (y=70) at x = 100/300/500/700/900. Because the segments join on
the centreline they read as one unbroken wave, and because the node columns
sit at the matching 10/30/50/70/90 % positions the nodes always land on it
at any width.

Each segment carries three offset ribbons (depth), a marching dot train
(`strokeDasharray` particles) and one slower, brighter comet pulse — all
travelling left to right, all only on segments the work has actually
reached.

### 2. Scale and hierarchy

- Section height went from ~200px to **365px** at desktop (brief asked for
  340–400px), against a 154px KPI rail — the journey is now ~2.4x the next
  element and unmistakably the page's centrepiece.
- Stage nodes grew from 48px to **64px**, each gaining a subtle outer ring
  and a soft coloured light when reached.
- Title is now the headline "From revenue opportunity to recovered money."
  under a small "THE RECOVERY JOURNEY" eyebrow, with a gradient rule whose
  colours run risk -> AI -> success, previewing the journey itself.

### 3. The destination is now the payoff

The fifth stage is an **88px** node with two concentric rings, its own
glow, and a core that only lights up — a luminous green disc — once the
backend actually reports recovered money. When a recovered case is opened
it plays **one** outward pulse, keyed on the case so it never loops.

### 4. The destination never overstates (`interventionSignals.ts`)

`buildCaseJourney` previously labelled the destination "Recovered" or
"At risk". It now resolves honestly:

| Real state | Label | Value shown |
|---|---|---|
| Completed and recovered | `Recovered` | real `recovered_amount` |
| Completed, not recovered | `Not recovered` | the amount still at risk |
| Executing now | `Recovery in progress` | backend `expected_recovery` |
| Queued (allowed or paused) | `Potential recovery` | backend `expected_recovery` |

For work that hasn't executed, the figure is the backend's own
`expected_recovery` (probability x amount) — the same number the case panel
labels "Potential recovery" — rather than the full exposure, so the
destination never implies more is recoverable than the model says.

### 5. Blocked cases break the stream visibly

The ribbons go dashed past the boundary, downstream nodes stay subdued, and
a `BoundaryMark` (amber halo, bar and dot, drawn in viewBox units at the
blocked segment's midpoint) sits in the break. The real `policy_reason`
still prints in the banner beneath — verified live with
"Amount exceeds auto-recovery ceiling (₹25,000)."

### 6. Atmosphere

A technical grid radially masked toward the stream, one cool light above
it, and a warm light at the destination that appears only once revenue has
actually landed. No blobs, no fog, no starfield.

## A real bug found and fixed

Stage 1 of a selected case rendered `— · ₹18,116` instead of the leak type.
`txById` only holds the first `TRANSACTION_LIMIT` (300) transactions, but
`/api/opportunities` ranks by expected recovery, so a high-value case can
sit outside that window. The journey now prefers `caseData.tx` — the
transaction the case panel already fetches for the open case — and falls
back to the map. Verified: `"1. Opportunity  Failed payment · ₹5,134"`.

## Reduced-motion / hydration

Every animated element in this component now keeps a **constant `initial`**
and varies only `animate`/`transition`, instead of being conditionally
rendered on `useReducedMotion()`. `useReducedMotion` resolves differently
on the server than on the client, so the old pattern produced different
markup in each and broke hydration under reduced motion.

Measured before and after, with reduced motion forced on:

- before: 4 errors on `/interventions`, including a full
  `Hydration failed ... entire root will switch to client rendering`
- after: **1** remaining, and it is not from this component

That remaining one is `Prop 'style' did not match ... translateY(-10px)`
from `app/(dashboard)/layout.tsx:46`, the **shared dashboard shell**, which
uses the same `initial={reduceMotion ? undefined : ...}` pattern. Confirmed
pre-existing and page-independent — under reduced motion, untouched routes
show it too (`mission-control` 3, `transactions` 1, `policies` 1). Fixing
the shell is out of scope for a single-page visual pass.

## Verification

- `npm run build`: compiled successfully (`/interventions` 20.9 kB /
  156 kB). `npx tsc --noEmit`: clean.
- Live backend, 94 opportunities (20 paused) and real executions.
- Real execution exercised end to end: destination moved from
  `"Potential recovery ₹2,888 / Awaiting execution"` to
  `"Recovered ₹5,134 / Recovered"`, with stage 3 -> "Retry payment
  executed" and stage 4 -> "Recovered".
- Widths 1440 / 1280 / 1024 / 768 / 390: page overflow 0px, ledger overflow
  0px, **zero console errors** at every width. Journey measures 365px on
  desktop and becomes a vertical progression at 768/390.
- 3 API requests on load (opportunities, interventions, transactions) — no
  duplicates.
