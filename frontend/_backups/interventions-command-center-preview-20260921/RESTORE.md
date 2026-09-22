# Interventions — "Recovery Journey" command centre rebuild — rollback backup

Taken 2026-09-21, before rebuilding `/interventions` around the reference
design supplied in the brief. Frontend visual/UX only — no backend change,
no API contract change, no change to any other page.

## To restore ("NAHH — RESTORE")

Copy every file below back to its original path.

| Backup path | Restore to |
|---|---|
| `app/(dashboard)/interventions/page.tsx` | `frontend/app/(dashboard)/interventions/page.tsx` |
| `components/interventions/ActionStream.tsx` | `frontend/components/interventions/ActionStream.tsx` |
| `components/interventions/InterventionLedger.tsx` | `frontend/components/interventions/InterventionLedger.tsx` |
| `components/interventions/InterventionDetail.tsx` | `frontend/components/interventions/InterventionDetail.tsx` |
| `components/interventions/interventionSignals.ts` | `frontend/components/interventions/interventionSignals.ts` |

The first four of those were **deleted** by this round (`ActionStream`,
`InterventionLedger`, `InterventionDetail` were fully replaced; the page
and signals file were rewritten) — restoring means copying them back, not
just reverting edits.

Then delete the new files this round adds (they did not exist before):

- `frontend/components/interventions/RecoveryJourney.tsx`
- `frontend/components/interventions/InterventionKpiRail.tsx`
- `frontend/components/interventions/ActionQueueTable.tsx`
- `frontend/components/interventions/InterventionCasePanel.tsx`

Nothing else was touched. `frontend/lib/api.ts`, `frontend/lib/types.ts`,
`frontend/lib/actionMeta.ts`, `frontend/lib/format.ts`,
`components/interventions/actionIcons.tsx`, the dashboard shell
(`layout.tsx`, `Header.tsx`, `Sidebar.tsx`) and every other page are
unchanged.

> Note: `git status` at the time of this round also shows
> `mission-control/page.tsx`, `policies/page.tsx`, `run.bat`, `warmup.ps1`
> and `components/recovery-controls/` as modified/new. Those belong to the
> two **earlier, still-pending** preview rounds
> (`recovery-controls-preview-20260920`, `local-performance-preview-20260920`)
> and are not part of this one.

## What was rebuilt

The page moves from a generic funnel + table + modal drawer to a single
connected operations surface:

1. **Hero header** — `OPERATIONS` / `Interventions` / "From insight to
   recovery…", with a live-refresh control where the reference puts a date
   range (see "Honest deviations" below).
2. **KPI rail** — Revenue at risk · Actions today · Recovered revenue ·
   Needs attention, each with a micro-visual that is itself a real
   derivation of the loaded data.
3. **The Recovery Journey** (`RecoveryJourney.tsx`) — the signature
   surface. Five stages (Opportunity → REVORA decision → Recovery action →
   Customer outcome → Recovered revenue) joined by flowing streams.
4. **Workspace** — action queue ledger on the left, intervention
   intelligence panel on the right, the two kept in sync with the journey.

## How the journey is driven by real data

`buildSystemJourney()` and `buildCaseJourney()` in `interventionSignals.ts`
produce the stage content, and critically a `reachedIndex` — how far the
work has actually got. The visuals read from it rather than animating
unconditionally:

- A connector only carries travelling light where `reachedIndex` has passed
  it. Unreached segments are dim static channels.
- With nothing selected, the journey summarises the whole operation
  (leaks identified, actions selected, ready vs paused, outcomes recorded,
  revenue recovered) — all counted from loaded records.
- Selecting a row switches it to that one case, and the terminal readout
  switches to that case's amount and status.
- A case stopped by recovery controls sets `boundary`, which renders the
  connector into stage 3 as a dashed channel with a boundary marker, marks
  that stage amber, and prints the real `policy_reason` beneath.
- `outcomeTone` keeps money still at risk from rendering in recovered-green.

## Data honesty notes

- **No invented trends.** The reference's `+12% / +20% / +18% / +33%`
  badges are deliberately absent: the backend keeps no historical series to
  compare against, so those could only ever be fabricated. Each KPI carries
  a real micro-visual instead — a leak-type composition of queued revenue,
  a 12-hour histogram of actual executions, a recovered/attempted ratio,
  and a paused/unresolved split.
- **No invented customers or invoices.** The reference's "Acme Corp /
  INV-2024-001" has no counterpart in the data, so the column shows the
  real `customer_id` and `transaction_id` and is labelled
  "Customer / Transaction".
- **Priority is the backend's own ranking, surfaced.**
  `GET /api/opportunities` computes `expected_recovery`
  (probability × amount) and returns the list sorted by it descending.
  `buildPriorityMap()` maps each case's position in that real ranking onto
  High/Medium/Low. The underlying figure is shown as "Potential recovery"
  in the case panel, so the label is always traceable. Completed rows get
  no priority — ranking finished work would be meaningless.
- **"Time" for queued work** comes from the transaction's real
  `hours_since_event` (how long the leak has existed), because opportunity
  records carry no timestamp of their own. Completed rows use the
  intervention's real `timestamp`.
- **In Progress is genuinely 0 or 1.** There is no persisted queued/
  executing state server-side (CLAUDE.md §17); the tab reflects the one
  real transient state this UI produces while a request is in flight.

## Honest deviations from the reference image

- **No date-range control.** The reference's "Last 7 days" would be
  filtering against data that doesn't exist — interventions only exist from
  the moment they're executed in-session, and queued work has no timestamp.
  That slot instead holds a Live/Paused control that genuinely governs the
  15-second background refresh, plus the existing manual refresh.
- **Shell left alone.** The reference shows a global search box in the top
  bar and a "Turning Overdue into Opportunity" card in the sidebar footer.
  Neither exists in REVORA's shell, and the brief said not to redesign the
  shell unnecessarily, so `Header.tsx` / `Sidebar.tsx` were not touched.
- **Violet stays reserved.** Per CLAUDE.md §5, violet is only used for
  things that are literally AI reasoning — here, the "REVORA decision"
  journey node and the "REVORA recommends" block. Revenue at risk uses
  system-blue rather than the reference's violet.
- **Priority as signal bars, not coloured pills.** The reference's
  red/amber/blue priority pills would collide with REVORA's semantic
  colours (red = blocked, amber = paused). Ranking is shown as three-step
  signal bars in a single hue so state colours keep their meaning.

## A real bug this round found and fixed in itself

The first implementation resolved the desktop/overlay split with
`matchMedia` during render. On the server that always resolved to the
desktop branch, so below 1280px the client rendered a different tree and
React threw `Hydration failed because the initial UI does not match what
was rendered on the server` at 1024 / 768 / 390px. Fixed by making the
split purely CSS (`min-[1440px]:`) and lifting the per-case fetch into
`useCaseData()` in the page, so both panel presentations share one set of
requests. Re-verified: zero console errors at all five widths.

## Verification performed

- `npm run build`: compiled successfully, zero TypeScript errors
  (`/interventions` 20 kB / 155 kB First Load JS).
- Browser-tested against the real backend with 94 opportunities
  (20 policy-blocked) and 6 executed interventions (2 recovered, ₹23,124).
- Real execution flow exercised end to end from the panel and from a row
  button: confirm → executing → the actual returned outcome.
- Widths checked: 1440 / 1280 / 1024 / 768 / 390 — page overflow 0px and
  ledger overflow 0px at every one, zero console errors.
- Exactly 3 API requests on load (opportunities, interventions,
  transactions) — no duplicates.
- Other dashboard routes smoke-tested (all 200).
