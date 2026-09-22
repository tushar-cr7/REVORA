# Recovery Brain preview round 2 — rollback backup

Taken 2026-09-15, before reworking Recovery Brain's BEFORE (idle) and DURING
(scanning) states into a full "Decision Field" narrative experience. This
round preserves the AFTER (results) state's visuals and behavior — decision
field, filters, queue, detail panel, execute flow, technical fold — exactly
as they were; only the idle and scanning states change.

Baseline for this round: the Decision Field implementation from the
previous round (uncommitted; see `frontend/_backups/recovery-brain-preview-20260915/`
for the round before that, which restores to the original pre-Decision-Field
model-metrics dashboard).

## To restore ("NAHH — RESTORE")

Copy every file below back to its original path — this returns Recovery
Brain to exactly the single-round-1 Decision Field state (idle/scanning
were the plain "No decision data available" card and a spinning button
label, before this round's rework):

| Backup path | Restore to |
|---|---|
| `app/(dashboard)/recovery-brain/page.tsx` | `frontend/app/(dashboard)/recovery-brain/page.tsx` |
| `components/recovery-brain/DecisionField.tsx` | `frontend/components/recovery-brain/DecisionField.tsx` |
| `components/recovery-brain/decisionField.utils.ts` | `frontend/components/recovery-brain/decisionField.utils.ts` |
| `components/recovery-brain/DecisionDetail.tsx` | `frontend/components/recovery-brain/DecisionDetail.tsx` |
| `components/recovery-brain/DecisionQueue.tsx` | `frontend/components/recovery-brain/DecisionQueue.tsx` |

Also delete the new file this round adds (it did not exist before this
round):

- `frontend/components/recovery-brain/DecisionStages.tsx`

(`DecisionDetail.tsx` and `DecisionQueue.tsx` are backed up defensively;
if this round ends up not touching them, restoring them is a no-op.)

## What this round changed, for reference

Recovery Brain gained an explicit phase state machine (`idle` → `scanning`
→ `completing` → `results`, plus `error`), mirroring the proven pattern
already used by Revenue Scanner:

- **Idle (BEFORE):** replaced the plain empty card with a "Ready to analyze
  recovery opportunities" hero: a plain-language Analyze → Evaluate →
  Check → Recommend pipeline explanation, and a dormant preview of the
  Decision Field (generic, deterministic, non-data-bound nodes — no
  fabricated business numbers) sitting quietly in its five lanes.
- **Scanning/Completing (DURING):** a left-hand time-paced diagnostic
  stage list (`DecisionStages.tsx`, styled like Scanner's `ScanStages`)
  narrates process while the real `scan → analyze → getOpportunities`
  request chain is in flight; the same dormant field on the right gets an
  animated vertical scan-line sweep with nodes brightening as it passes.
  Progress narration is time-paced, capped, and never invents a number the
  API didn't return.
- **Results (AFTER):** unchanged — same `DecisionField` results-mode
  rendering, filters, queue, detail panel and technical fold as before.
  `DecisionField` now takes an explicit `phase` prop; the `results` render
  path is untouched code, just gated behind `phase === 'results'` instead
  of an implicit `opportunities.length` check.
