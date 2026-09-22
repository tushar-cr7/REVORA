# Recovery Brain preview — rollback backup

Taken 2026-09-15, before replacing Recovery Brain's model-metrics-dashboard
layout with a "Decision Field" visual identity (decision intelligence,
distinct from Revenue Command's money-flow and Revenue Scanner's X-ray
scan). Baseline checkpoint for this round: commit `7197ccc`
("feat(ui): establish revora iconography system").

Purely a visual/UX pass on one page — no layout of other pages, no backend,
no API contract changes.

## To restore ("NAHH — RESTORE")

1. Copy the file below back over the current version:

| Backup path | Restore to |
|---|---|
| `app/(dashboard)/recovery-brain/page.tsx` | `frontend/app/(dashboard)/recovery-brain/page.tsx` |

2. Delete the new files this round added (they did not exist before this
   round, so restoring means removing them, not overwriting them):

- `frontend/components/recovery-brain/DecisionField.tsx`
- `frontend/components/recovery-brain/DecisionQueue.tsx`
- `frontend/components/recovery-brain/DecisionDetail.tsx`
- `frontend/components/recovery-brain/decisionField.utils.ts`

`BrainPanel.tsx`, `RevoraActivity.tsx`, and `RevoraMissionLog.tsx` were not
touched. The first two are pre-existing unused files; `RevoraMissionLog` is
used by `mission-control/page.tsx`, out of scope for this round.

## What this round changed, for reference

Recovery Brain's identity became "Decision Field" — a field of decision
nodes grouped into five horizontal lanes (Retry / Payment Link / Reminder /
Escalate / Suppress), positioned left-to-right by real recovery probability,
sized by real transaction amount, and brightened by a real
confidence × value prominence score so the highest-value, highest-confidence
decisions visually surface out of the noise on load — no fabricated data,
all fields come from `GET /api/opportunities`.

Selecting a node (or a Decision Queue row) lazy-loads the real transaction
and decision record, shows REVORA's actual competing candidate scores
(`Decision.candidates_evaluated`) as ghost markers in their lanes, and
opens a Decision Detail panel: recommended action, recovery likelihood,
a "why" explanation computed from real transaction fields (prior
successful payments, retry count, LTV segment, evaluated-candidate
ranking — never invented numbers), a safety check using the backend's own
`policy_reason` text, and an execute/review action reusing the existing
`api.executeIntervention` call already used elsewhere in the app. Model
internals (AUC, Brier, model version, decision architecture diagram) were
kept, not deleted, folded into a collapsed "View Technical Details"
section at the bottom of the page.
