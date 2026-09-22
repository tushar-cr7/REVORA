# Interventions reference-driven rebuild — rollback backup

Taken 2026-09-15/16, before a visual composition rebuild of Interventions
driven by a user-supplied design reference screenshot (a generic ops-console
mock, not a REVORA screenshot). Frontend visual/UX only — no backend, API,
policy, decision-engine or executor changes.

This is the round *after* `interventions-preview-20260915/` (the original
Action Control build). Restoring from here returns Interventions to that
round's state, not the pre-Interventions original (which is one round
further back in that earlier backup).

## To restore ("NAHH — RESTORE")

Copy every file below back to its original path.

| Backup path | Restore to |
|---|---|
| `app/(dashboard)/interventions/page.tsx` | `frontend/app/(dashboard)/interventions/page.tsx` |
| `components/interventions/ActionStream.tsx` | `frontend/components/interventions/ActionStream.tsx` |
| `components/interventions/InterventionLedger.tsx` | `frontend/components/interventions/InterventionLedger.tsx` |
| `components/interventions/InterventionDetail.tsx` | `frontend/components/interventions/InterventionDetail.tsx` |
| `components/interventions/interventionSignals.ts` | `frontend/components/interventions/interventionSignals.ts` |
| `components/interventions/actionIcons.tsx` | `frontend/components/interventions/actionIcons.tsx` |
| `lib/actionMeta.ts` | `frontend/lib/actionMeta.ts` |

No new files were added this round (only existing files were restructured),
so there is nothing to delete after restoring.

## What the reference image was used for, and what it wasn't

The user supplied a design-reference screenshot (generic dark ops-console
mock with placeholder numbers like ₹2.31L, 121, 32). Per the brief, it was
used **only** for layout, density, composition and interaction-quality
guidance. Every number, status, and label in the rebuilt page still comes
from REVORA's real `/api/opportunities` and `/api/interventions` data —
none of the reference's example values were copied in.

Two reference elements were deliberately **not** reproduced because nothing
in the real data model backs them honestly:

- **Time-range tabs (Today / 7D / 30D / All):** `Opportunity` records carry
  no timestamp, so a time filter could only ever apply to half the ledger
  (completed rows) while silently doing nothing to queued rows. Implemented
  instead: a real "Last updated {time}" readout tied to the last successful
  load.
- **Trend arrows on KPI cells (↑12%, ↑8%, …):** there is no stored prior
  snapshot to compare against. Kept the reference's secondary caption line
  under each KPI value instead, filled with real derived context (e.g.
  "₹X recovered", "Requires human review") rather than a fabricated
  percentage change.
- **"Add note" / "Create escalation ticket" controls:** no backing API
  exists for either. Not added — the single real action (execute /
  review-and-execute-the-safe-alternative) was kept as the sole CTA,
  matching the "do not fake functionality" rule that held throughout this
  session.
- **Row checkboxes / bulk actions:** no bulk-execute endpoint exists.
  Omitted rather than added as non-functional decoration.

## What this round changed, for reference

- **KPI strip** grew from 5 to 6 cells to match the reference's rail:
  Revenue at Risk (queue exposure), Actions Today, In Progress (0 or 1 —
  the only honest value, since nothing here is ever concurrently
  "in progress" server-side), Completed, Blocked, Needs Attention. Each
  keeps a real one-line caption instead of a fabricated trend indicator.
- **Action Stream** gained a pipeline-funnel header above the existing
  Ready/Executing/Completed chip lanes: **Decided → Ready → Executing →
  Completed**, with real counts and a real caption per stage (e.g.
  "₹X recovered" on Completed). "Decided" is `opportunities.length` as
  actually returned by the backend (which includes already-executed
  transactions the backend doesn't filter out) — a true "everything REVORA
  has ever decided on" count, distinct from "Ready" (not yet executed).
- **Ledger status badges** now show a real "In Progress" state (violet,
  with the spinner) for the one row currently being executed, matching the
  reference's status vocabulary.
- **Filter chips** now show real per-action counts, e.g. "Retry (56)".
- **Detail panel** restructured from a single scrolling column into tabs
  (Overview / Timeline / Transaction / Technical) matching the reference's
  composition — Transaction is a new tab surfacing real transaction fields
  (customer, payment method, failure reason, LTV, retries) that previously
  weren't shown in this panel at all. Primary CTA copy now reads "Review
  Case" for a blocked/paused case and "Execute Recovery" for a ready one,
  matching the reference's language, while still calling the exact same
  real `executeIntervention` flow underneath.
