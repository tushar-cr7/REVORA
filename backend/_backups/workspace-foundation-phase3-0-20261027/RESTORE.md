# Restore — Phase 3.0 workspace foundation (2026-10-27)

What this round changed: added migration `0003_workspaces.sql` (a `workspaces` table, backfill of every
pre-existing workspace id as a demo workspace, the seeded demo workspace `merch_001`, immutability trigger,
and `scan_runs.workspace_kind` with constraints so a synthetic scan run can only exist in a registered demo
workspace), the workspace domain module, repository support on both implementations, a guard in
`RecoveryService.scan_revenue`, and typed 422/409 errors on `POST /api/scan`. Details:
`docs/PHASE_3_CHECKPOINT.md`.

## Modified files (copy back to restore)

| Backup path | Original path |
|---|---|
| `backend/app/repositories/base.py` | `backend/app/repositories/base.py` |
| `backend/app/repositories/postgres.py` | `backend/app/repositories/postgres.py` |
| `backend/app/repositories/in_memory.py` | `backend/app/repositories/in_memory.py` |
| `backend/app/services/recovery_service.py` | `backend/app/services/recovery_service.py` |
| `backend/app/api/routes.py` | `backend/app/api/routes.py` |
| `backend/tests/support.py` | `backend/tests/support.py` |
| `backend/tests/integration/test_postgres_schema.py` | `backend/tests/integration/test_postgres_schema.py` |
| `backend/tests/integration/test_durability_processes.py` | `backend/tests/integration/test_durability_processes.py` |

(Backup paths are relative to this directory; original paths are relative to the repository root.)

## New files (delete to restore)

- `backend/app/db/migrations/0003_workspaces.sql`
- `backend/app/domain/workspaces.py`
- `backend/tests/integration/test_workspaces.py`
- `backend/tests/unit/test_workspace_rules.py`
- `docs/PHASE_3_CHECKPOINT.md`

## Database caution

A database that has already applied migration 0003 cannot be restored by copying files: the code without
0003 refuses to start against a schema that is ahead of it (`SchemaNotReady: ... ahead of this code`), by
design. There are no down-migrations. Restoring the files is only safe for databases that never ran 0003
(e.g. any database before this round, and the disposable test clusters). The user's installed PostgreSQL
database was not migrated in this round.

After restoring, re-run: `REVORA_TEST_DATABASE_URL= REVORA_REQUIRE_POSTGRES=1 python -m pytest backend/tests -p no:cacheprovider -q`
(baseline before this round: 470 passed).
