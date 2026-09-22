# Transactions preview — rollback backup

Taken 2026-09-15, before rebuilding Transactions into a "Revenue
Investigation Ledger" and reworking the shared transaction drawer into a
forensic investigation panel. Frontend visual/UX only — no backend, no API
contract, no policy or execution behavior changes.

## To restore ("NAHH — RESTORE")

Copy every file below back to its original path.

| Backup path | Restore to |
|---|---|
| `app/(dashboard)/transactions/page.tsx` | `frontend/app/(dashboard)/transactions/page.tsx` |
| `components/drawer/TransactionDrawer.tsx` | `frontend/components/drawer/TransactionDrawer.tsx` |

Then delete the new files this round adds (they did not exist before):

- `frontend/components/transactions/TransactionLedger.tsx`
- `frontend/components/transactions/transactionSignals.ts`

## Note on the shared drawer

`TransactionDrawer.tsx` is shared: it is opened from **Transactions** and
also from **Revenue Command** (`mission-control/page.tsx`). Revenue
Command's own page code is NOT touched by this round, and the drawer's
props contract (`transactionId`, `onClose`, `onRefresh`) is unchanged, so
Revenue Command keeps working exactly as before — it simply opens the
improved investigation panel. Restoring the drawer from this backup
reverts both entry points together.

## What this round changed, for reference

- **Ledger surface:** the table stays a table (not cards), but gains a real
  visual hierarchy — amount at risk is the loudest cell, recovery
  probability reads as a semantic tier, failure reason is subordinated
  under payment method, and each row carries a thin left "risk signal rail"
  colored by recovery tier so thousands of rows can be scanned quickly.
- **Intelligence strip:** a compact toolbar (not dashboard cards) above the
  table showing revenue at risk, transaction count, high-recovery count and
  repeated-failure count — all computed deterministically from the
  already-loaded transaction records. Nothing is invented; when no
  intelligence pass has scored the set, probability-derived figures show
  as unavailable rather than as zero.
- **Filter bar:** the leak-type `<select>` became segmented chips, plus
  derived secondary filters (High recovery / Repeated failures / High value
  / Recent) computed from loaded data only. Search is unchanged.
- **Sorting:** opt-in sortable headers on Amount, Recovery and Age. Default
  order is the API's natural order, so initial behavior is unchanged.
- **States:** skeleton rows while loading, a real investigation empty state,
  and a professional error state with retry (no stack traces).
- **Mobile:** below `md` the table is replaced by a compact investigation
  list preserving transaction, leak, amount, recovery and action; it opens
  the same drawer.
- **Drawer:** restructured into Revenue Event → Recovery Signal → REVORA
  Recommendation → Action, with an honest timeline built only from real
  timestamps (`event_time`, `decision.created_at`) and real counts
  (`retries_so_far`) — no fabricated per-attempt times. The action footer
  now reflects the existing policy state (paused/review wording when
  `policy_allowed` is false) while calling the exact same
  `executeIntervention` API with the same already-policy-safe
  `final_action`. Policy behavior itself is unchanged.
- Fixed a pre-existing inaccuracy: the drawer's customer tab hard-coded
  "High Value Customer Segment" for every customer; it now reflects the
  real `ltv_bucket`.
