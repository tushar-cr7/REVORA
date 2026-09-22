# Transactions investigation panel — rollback backup

Taken 2026-09-15, before rebuilding the transaction drawer into a full
"Revenue Case" investigation panel. Frontend visual/interaction only — no
backend, API, policy, decision-engine or executor changes.

This is the round *after* `transactions-preview-20260915/` (which turned the
Transactions page into an investigation ledger). Restoring from here returns
the drawer to that previous ledger-round state, not to the original.

## To restore ("NAHH — RESTORE")

Copy every file below back to its original path.

| Backup path | Restore to |
|---|---|
| `components/drawer/TransactionDrawer.tsx` | `frontend/components/drawer/TransactionDrawer.tsx` |
| `components/transactions/TransactionLedger.tsx` | `frontend/components/transactions/TransactionLedger.tsx` |
| `components/transactions/transactionSignals.ts` | `frontend/components/transactions/transactionSignals.ts` |

Then delete the new files this round adds (they did not exist before):

- `frontend/components/transactions/caseSignals.ts`
- `frontend/components/transactions/SignalPath.tsx`

(`transactionSignals.ts` is backed up defensively; if this round doesn't
touch it, restoring it is a no-op.)

## Note on the shared drawer

`TransactionDrawer.tsx` is opened from **Transactions** and also from
**Revenue Command** (`mission-control/page.tsx`). Revenue Command's page code
is untouched and the drawer's props contract
(`transactionId`, `onClose`, `onRefresh`) is unchanged, so Revenue Command
keeps working — it inherits the same investigation panel. Restoring the
drawer reverts both entry points together.

## What this round changed, for reference

- The drawer's four tabs (Investigation / Timeline / Customer / Raw Data)
  were replaced by a single flowing **Revenue Case** panel: case header →
  signal path → why this needs attention → REVORA recommends → safety check
  → case timeline → transaction details → raw data, with the deeper
  sections collapsed behind disclosures instead of tabs.
- Added a compact signature visual — a four-node **EVENT → LEAK → SIGNALS →
  RECOVERY** signal path whose node states are derived from real data
  presence (event time, leak type, whether the transaction has been scored,
  and the actual decision/intervention outcome).
- **Safety check** now renders individually named recovery controls
  evaluated against the live policy limits from `GET /api/policies`
  (retry limit, contact window, auto-recovery ceiling), with the backend's
  own `policy_allowed` / `policy_reason` remaining the authoritative
  verdict. No check result is faked.
- **Completed state**: the drawer now fetches interventions and surfaces a
  real `RECOVERY COMPLETED` / action-completed state with the actual
  outcome and recovered amount when one exists for the transaction.
- Behavior change worth noting: executing an action previously closed the
  drawer immediately. It now stays open and shows the returned
  intervention's real outcome, while still calling `onRefresh()` so the
  ledger updates. Closing is manual.
- Staged reveal animation (~500ms total) on open, disabled under
  `prefers-reduced-motion`. Mobile (<640px) uses a bottom sheet instead of
  a side panel.
- Ledger: selected rows gain a subtle left accent anchoring them to the
  open case. No other table changes.
