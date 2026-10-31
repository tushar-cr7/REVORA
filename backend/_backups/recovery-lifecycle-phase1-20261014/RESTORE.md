# Phase 1 — Recovery case lifecycle, attempt ledger & execution safety (2026-10-14)

## What this round changed and why

Verified against the code (probe scripts reproduced each), the audit's four risks were real:

- **R1/R2** — `POST /interventions/{id}/execute` re-ran any transaction on every call with a
  new key; retry counters never moved (40 executions of one ₹2,146 item gave 19 "recoveries"
  and ₹40,778 in analytics), and a second `POST /recover` re-rolled every outcome.
- **R3** — an idempotency key was a global map entry: reusing it for another transaction
  returned the first transaction's intervention.
- **R4** — a re-scan replaced transactions in place while decisions/interventions/audit
  stayed; the same `transaction_id` is a different record across scans (66 of 100 shared ids
  differed in amount), so a ₹780 decision/intervention ended up attached to a ₹851 transaction.

Backend changes (frontend only gets optional type fields): scan runs, recovery cases with an
explicit state machine, an attempt ledger, execution-time strict policy re-evaluation from
that ledger, scoped + fingerprinted idempotency, an `atomic()` repository section, bulk
recovery through the same pathway, run-scoped reads/analytics/audit. Full description:
`docs/RECOVERY_LIFECYCLE.md`.

No Git commands were used. Backend `.py` files are backed up with a `.bak` suffix so pytest
cannot collect or import the copies.

## Restore table (backup → original)

| Backup (under this directory) | Original |
|---|---|
| `app/api/routes.py.bak` | `backend/app/api/routes.py` |
| `app/api/schemas.py.bak` | `backend/app/api/schemas.py` |
| `app/domain/models.py.bak` | `backend/app/domain/models.py` |
| `app/domain/policy.py.bak` | `backend/app/domain/policy.py` |
| `app/integrations/base.py.bak` | `backend/app/integrations/base.py` |
| `app/integrations/simulation.py.bak` | `backend/app/integrations/simulation.py` |
| `app/intelligence/decision_engine.py.bak` | `backend/app/intelligence/decision_engine.py` |
| `app/repositories/base.py.bak` | `backend/app/repositories/base.py` |
| `app/repositories/in_memory.py.bak` | `backend/app/repositories/in_memory.py` |
| `app/services/audit_service.py.bak` | `backend/app/services/audit_service.py` |
| `app/services/recovery_service.py.bak` | `backend/app/services/recovery_service.py` |
| `tests/integration/test_audit_filters.py.bak` | `backend/tests/integration/test_audit_filters.py` |
| `root/CLAUDE.md.bak` | `CLAUDE.md` |
| `root/README.md.bak` | `README.md` |
| `root/PROJECT_STRUCTURE.md.bak` | `PROJECT_STRUCTURE.md` |
| *(frontend)* `frontend/_backups/recovery-lifecycle-phase1-preview-20261014/lib/types.ts` | `frontend/lib/types.ts` |

Files that did not exist before this round (delete them when restoring):

- `backend/app/services/execution_service.py`
- `backend/tests/support.py`
- `backend/tests/unit/test_policy_strict.py`, `backend/tests/unit/test_case_lifecycle.py`
- `backend/tests/integration/test_recovery_lifecycle.py`, `backend/tests/integration/test_execution_api.py`
- `docs/RECOVERY_LIFECYCLE.md`

After restoring, restart the backend (state is in memory) and run `pytest backend/tests`.

## Note on the one existing test that changed

`test_audit_filters.py::_seed_and_execute_one` used to execute "the first transaction" of the
same scan on every call with a fresh key — exactly the repeat-execution behaviour R2 describes.
Only the helper changed (it now picks a transaction that has not been executed yet); every
assertion in the file is unchanged.
