# Phase 2 — Durable data foundation & event ingestion (2026-10-22)

## What this round changed and why

Phase 1 made recovery state *correct* inside one process; this round makes it *durable and safe across
processes* and adds the first path for facts about real payments to arrive. Full description, schema,
atomic boundaries, limitations and a reviewer checklist: `docs/DURABLE_FOUNDATION.md`.

* PostgreSQL repository + versioned SQL migrations (`backend/app/db/`, `repositories/postgres.py`), explicit
  storage selection (`REVORA_STORAGE`), no silent in-memory fallback.
* `ExecutionService` restructured into committed units of work (reserve / provider / complete / abort);
  refusals are returned from the unit and raised after commit; interrupted reservations are recoverable.
* Event ingestion foundation: normalized contract, `POST /api/ingest/events`, dedup by source identity,
  order-insensitive obligation projection, detection boundary opening/closing inert cases.
* Found while doing it (all fixed, all covered by tests): `_abort_reservation` mutated objects and never saved
  them (invisible with live in-memory objects, a stuck `executing` case on any real database); truncated
  32–40-bit ids that silently collided in memory and would be hard primary-key failures in a database;
  tests that passed without the safeguard they claimed to test (four, rewritten until a mutation was caught).

No Git commands were intended or needed to make these changes. (One read-only `git status` was run by
mistake while checking the build and its output was discarded; it changed no content.) Backend `.py` files are
backed up with a `.bak` suffix so pytest cannot collect or import the copies.

## Restore table (backup → original)

| Backup (under this directory) | Original |
|---|---|
| `app/config.py.bak` | `backend/app/config.py` |
| `app/main.py.bak` | `backend/app/main.py` |
| `app/api/routes.py.bak` | `backend/app/api/routes.py` |
| `app/api/schemas.py.bak` | `backend/app/api/schemas.py` *(backed up, ended up unchanged)* |
| `app/domain/models.py.bak` | `backend/app/domain/models.py` |
| `app/integrations/simulation.py.bak` | `backend/app/integrations/simulation.py` |
| `app/repositories/base.py.bak` | `backend/app/repositories/base.py` |
| `app/repositories/in_memory.py.bak` | `backend/app/repositories/in_memory.py` |
| `app/services/audit_service.py.bak` | `backend/app/services/audit_service.py` |
| `app/services/execution_service.py.bak` | `backend/app/services/execution_service.py` |
| `app/services/recovery_service.py.bak` | `backend/app/services/recovery_service.py` |
| `requirements.txt.bak` | `backend/requirements.txt` |
| `tests/conftest.py.bak` | `backend/tests/conftest.py` |
| `docs/RECOVERY_LIFECYCLE.md.bak` | `docs/RECOVERY_LIFECYCLE.md` |
| `root/.env.example.bak` | `.env.example` |
| `root/CLAUDE.md.bak` | `CLAUDE.md` |
| `root/README.md.bak` | `README.md` |
| `root/PROJECT_STRUCTURE.md.bak` | `PROJECT_STRUCTURE.md` |
| `root/git-handoff.json.bak` | `.revora/git-handoff.json` |

`audit_service.py.bak` and `simulation.py.bak` were reconstructed by reversing exactly my two edits to each (the
files were edited before they were backed up); the diff of each against the current file shows only those edits.

No frontend file was modified in this round (no frontend backup exists for it).

## Files that did not exist before this round (delete them when restoring)

Application
* `backend/app/container.py`
* `backend/app/api/runtime.py`, `backend/app/api/ingestion_routes.py`
* `backend/app/db/` (`__init__.py`, `pool.py`, `migrate.py`, `migrations/0001_core_recovery_schema.sql`, `migrations/0002_event_ingestion.sql`)
* `backend/app/domain/events.py`
* `backend/app/ingestion/` (`__init__.py`, `schemas.py`, `projection.py`, `adapters.py`)
* `backend/app/repositories/postgres.py`, `backend/app/repositories/errors.py`
* `backend/app/services/detection_service.py`, `backend/app/services/ingestion_service.py`

Tests
* `backend/tests/pg_support.py`, `backend/tests/events_support.py`, `backend/tests/tools/mutation_check.py`
* `backend/tests/unit/test_storage_config.py`, `test_ingestion_contract.py`, `test_event_projection.py`, `test_pg_harness.py`
* `backend/tests/integration/test_ingestion_flow.py`, `test_ingestion_api.py`, `test_postgres_schema.py`,
  `test_postgres_repository.py`, `test_postgres_execution.py`, `test_postgres_ingestion.py`, `test_durability_processes.py`

Docs
* `docs/DURABLE_FOUNDATION.md`

## After restoring

The restored backend selects `InMemoryRepository` directly again (no `REVORA_STORAGE`). Any database created by
this round is left untouched (drop it yourself; nothing in the restored code reads it). Restart the backend and
run `pytest backend/tests`.

## One existing test whose expected count changed — and why

Adding the `resolved_at_source` case state grows the parametrized
`test_case_lifecycle.py::test_every_move_outside_the_table_is_rejected_and_leaves_the_case_untouched` from 51 to 64
cases (172 → 185 Phase 1 tests collected). No assertion in any Phase 1 test was edited, loosened or removed.
`TERMINAL_CASE_STATES` is deliberately unchanged because a test pins it; the new state lives in
`SOURCE_CLOSED_CASE_STATES` / `CLOSED_CASE_STATES` instead.
