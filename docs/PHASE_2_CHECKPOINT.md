# Phase 2 checkpoint — final verification (2026-10-27)

Scope: durable PostgreSQL persistence + normalized event ingestion (`docs/DURABLE_FOUNDATION.md`).
Everything below was run in the closing session unless marked otherwise. A passing suite is not a
production-readiness claim.

## 1. Burst / deadlock regression

- The deadlock occurs inside one `INSERT` (two speculative inserts into the obligation's two unique indexes). It
  cannot be forced from outside the server without PostgreSQL injection points, so
  `test_bursts_of_first_events_for_brand_new_objects_never_deadlock` **cannot be made deterministic**. With the fix
  reverted it still passes (mutation run: "1 failed, 1 passed" — the burst test is the one that passes).
  It stays as a stress test; it is **not** a regression detector.
- The guarantee that prevents the interleaving is tested deterministically instead:
  `test_the_first_event_about_an_object_waits_on_that_objects_advisory_lock_before_inserting` (a separate session
  holds the object's advisory lock; the worker must be seen waiting on it in `pg_locks`, then proceed on release).
  It passes on the real code and **fails** when the fix is reverted. Two mutation entries cover it
  ("burst fix reverted", "obligation advisory lock removed").
- Production code was not changed. `backend/app/repositories/postgres.py` was verified byte-identical to
  `postgres.py.interrupted-sweep-copy` after the sweep; the advisory lock and `ON CONFLICT DO NOTHING`
  (line ~1288/1295) are present; no mutation is applied.

## 2. Mutation sweep (`backend/tests/tools/mutation_check.py`)

19 mutations: **19 CAUGHT, 0 NOT CAUGHT**. Run through a scratch wrapper (session scratchpad, outside the repo)
that suppresses the tool's deletion of `postgres.py.mutation_backup`, so both backup files still exist.

## 3. Build and test results

| Check | Result |
|---|---|
| `REVORA_REQUIRE_POSTGRES=1 python -m pytest backend/tests -p no:cacheprovider -q` | **462 passed**, 0 failed, 204 s (PostgreSQL 18.6 / Windows). 461 earlier + the new deterministic test. |
| `npm run build` (in `frontend/`) | Succeeded: compiled, types valid, 22/22 static pages. |
| Browser smoke test | **Not performed.** No Playwright/Puppeteer (npm or Python) is installed; I did not install anything, per instruction. |

The browser UI has therefore still not been exercised against PostgreSQL storage; data-after-restart in the UI is
unverified (backend restart durability is covered by the real-OS-process tests, and an earlier HTTP-level smoke test).

## 4. Files changed in this closing session

- `docs/DURABLE_FOUNDATION.md` (§12: sweep result and the burst-test caveat)
- `docs/PHASE_2_CHECKPOINT.md` (this file)
- Not changed: `CLAUDE.md` and `docs/PHASE_IMPLEMENTATION_NOTES.md` already carried 462 tests, the Phase 2
  "functionally complete, not production-ready" status and a pointer to these caveats. `.revora/git-handoff.json`
  not updated (see verdict). The earlier tool-fix and test additions (mutation entries, deterministic test) predate
  this session. No Git commands run; no files deleted.
- Kept pending your approval to delete: `postgres.py.mutation_backup`, `postgres.py.interrupted-sweep-copy`.

## 5. Outstanding limitations

No authentication/tenancy; `SimulationProvider` only; no real provider adapter or merchant data; event-derived cases
cannot be decided/executed; audit log not tamper-evident; no backup/HA/retention; pull-based recovery of
interrupted reservations; whole-run reads; PostgreSQL 18.6 on Windows only; no load testing; the burst stress test
has no regression-detecting power on its own; no browser verification.

## 6. Verdict

**Phase 2 backend: closed.** All backend gates pass and every safeguard mutation is caught. **One item remains
open: browser verification** against PostgreSQL storage (needs Playwright, ~one temporary `npm install --no-save`,
which needs your approval). I did not write `.revora/git-handoff.json`, since that step belongs after that check.
