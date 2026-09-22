# Interventions "Action Control" — rollback backup

Taken 2026-09-15, before rebuilding Interventions into an operational
"Action Control" console. Frontend visual/UX only — no backend, API,
policy, decision-engine or executor changes.

## To restore ("NAHH — RESTORE")

Copy every file below back to its original path.

| Backup path | Restore to |
|---|---|
| `app/(dashboard)/interventions/page.tsx` | `frontend/app/(dashboard)/interventions/page.tsx` |
| `components/transactions/caseSignals.ts` | `frontend/components/transactions/caseSignals.ts` |

Then delete the new files this round adds (they did not exist before):

- `frontend/lib/actionMeta.ts`
- `frontend/components/interventions/interventionSignals.ts`
- `frontend/components/interventions/ActionStream.tsx`
- `frontend/components/interventions/InterventionLedger.tsx`
- `frontend/components/interventions/InterventionDetail.tsx`

## Note on the shared helper move

`caseSignals.ts` (Transactions) is backed up because this round moves its
generic, non-Transactions-specific helpers (`actionLabel`, `OUTCOME_LABEL`,
`buildSafetyChecks`, `buildRationale`) into the new shared
`frontend/lib/actionMeta.ts`, and re-exports them from `caseSignals.ts` so
`TransactionDrawer.tsx` needs no changes and Transactions' behavior is
byte-identical. Restoring `caseSignals.ts` from this backup undoes that move
and returns those helpers to being Transactions-only again.

## Real data model this round is honest about

`GET /api/interventions` only ever returns **already-executed, terminal**
records (`recovered | attempted_no_recovery | suppressed |
escalated_to_merchant`) — there is no persisted "queued" or "in progress"
intervention state in the backend. So:

- **Recovery Queue** = `GET /api/opportunities` entries whose
  `transaction_id` doesn't yet appear in the loaded interventions — i.e.
  decided-but-not-yet-executed work. This is real, not synthetic.
- **Executing** is a genuine transient client state that only exists while
  an `executeIntervention` request for that specific item is in flight.
- No summary metric claims a persisted "in progress" count, since none
  exists in the data.

## What this round changed, for reference

- Header gained a real connectivity indicator ("Recovery controls online" /
  "Syncing" / hidden on error) — reusing the exact pulsing-dot pattern
  already established in `components/layout/Header.tsx`'s "SYSTEM ACTIVE"
  badge, not a new claim of literal background activity.
- Operational summary strip: Revenue Recovered, Completed Today, Queued,
  Blocked, Needs Attention — every figure derived from loaded
  opportunities/interventions, nothing invented.
- Signature visual: a compact three-lane **Ready → Executing → Completed**
  action stream showing real queued and recently-completed items as small
  action chips. Executing an item plays a shared-`layoutId` Framer Motion
  transition of that exact chip moving from Ready through Executing into
  Completed once the real API response resolves.
- Needs Attention: blocked queued items + escalated/no-recovery completed
  items, most recent first.
- One unified Recovery Queue ledger table (queued + completed rows,
  status-differentiated) replacing the old completed-only table, with
  action-type and status filters plus search.
- New `InterventionDetail` side panel ("Action Control Center"): action
  header, why this action (reusing Transactions' rationale/evidence
  derivation), safety check against live policy limits, a static
  per-action-type behavior preview, a real timeline (Detected → Decision
  made → Executed/Awaiting execution), and collapsed technical details.
  Executing from here shows a real confirm step, a real "Executing..."
  state, then the actual returned outcome — never a faked success.
- Mobile (<640px): compact list + bottom-sheet detail, matching the pattern
  established in Transactions/TransactionDrawer this session.
