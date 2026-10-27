"""
Mutation check for the concurrency / atomicity safeguards (Phase 2).

    python backend/tests/tools/mutation_check.py                 # every mutation
    python backend/tests/tools/mutation_check.py "customer lock"  # those whose name contains the text

For each entry it breaks ONE safeguard in the application source (a single exact-text replacement), runs the
test(s) that are supposed to catch it, and restores the file. A safeguard whose removal leaves its tests green is
reported as NOT CAUGHT and means a test has no teeth.

SAFETY: it edits files under backend/app in place and restores them in a `finally`. If the process is killed
mid-run, a `<file>.mutation_backup` is left next to the file: copy it back over the original. Never run it while
anything else is editing those files. Needs PostgreSQL for the tests it invokes (REVORA_TEST_DATABASE_URL, or the
test harness starts a throwaway cluster per mutation, which is slower).
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.chdir(ROOT)

PG = "backend/app/repositories/postgres.py"
EX = "backend/app/services/execution_service.py"

T = "backend/tests/integration/test_postgres_execution.py"
TI = "backend/tests/integration/test_postgres_ingestion.py"
TR = "backend/tests/integration/test_postgres_repository.py"

# (name, file, exact text to replace, replacement, tests that must fail)
# `old` may instead be a list of (old, new) pairs, all applied together.
MUTATIONS = [
    ("customer advisory lock removed", PG,
     r'''with self._cursor() as cur:
            cur.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (f"revora:customer:{merchant_id}:{customer_id}",),
            )''',
     "return None",
     [f"{T}::test_the_daily_contact_cap_holds_across_a_customers_cases_executed_in_parallel"]),
    ("case row lock removed (no FOR UPDATE on get_case)", PG,
     r'''lock = " FOR UPDATE" if self._in_atomic() else ""
        with self._cursor() as cur:
            cur.execute(f"SELECT * FROM recovery_cases WHERE case_id = %s{lock}", (case_id,))''',
     r'''lock = ""
        with self._cursor() as cur:
            cur.execute(f"SELECT * FROM recovery_cases WHERE case_id = %s{lock}", (case_id,))''',
     [f"{T}::test_distinct_keys_for_one_case_from_many_workers_produce_one_effect"]),
    ("shared lock on the active run removed", PG,
     'lock = " FOR SHARE" if self._in_atomic() else ""', 'lock = ""',
     [f"{T}::test_a_scan_cannot_slip_between_authorization_and_reservation"]),
    ("duplicate-key retry removed", EX,
     "            except DuplicateIdempotencyKey:\n                # Another request created",
     "            except ZeroDivisionError:\n                # Another request created",
     [f"{T}::test_one_key_raced_across_two_different_cases_lets_one_win_and_rolls_the_other_back_whole"]),
    ("denial raised inside the unit of work (rolls the record back)", EX,
     "                return self._record_denial(case, attempt, verdict, key, now_iso)",
     "                raise self._record_denial(case, attempt, verdict, key, now_iso).error",
     [f"{T}::test_a_denied_request_is_a_committed_record_that_replays_without_writing_again",
      f"{T}::test_the_retry_cap_holds_and_every_denial_is_committed"]),
    ("abort path forgets to save the attempt", EX,
     "        self.repo.save_attempt(attempt)\n        self.repo.save_case(case)\n        if attempt.idempotency_key:",
     "        if attempt.idempotency_key:",
     [f"{T}::test_completion_is_atomic_a_late_failure_undoes_every_write_of_the_unit",
      f"{T}::test_startup_recovery_closes_an_abandoned_reservation_as_a_failed_counted_attempt"]),
    ("reclaim shares the reservation's unit of work", EX,
     "        with self.repo.atomic():\n            self._reclaim_if_stale(self.repo.get_case(case_id))\n", "",
     [f"{T}::test_the_next_request_for_the_case_reclaims_a_dead_reservation_without_any_sweep"]),
    ("stale-reservation guard removed from completion", EX,
     "            if attempt.status != AttemptStatus.RESERVED:  # reclaimed while the provider call was in flight\n                return self._expired(case, attempt)\n",
     "",
     [f"{T}::test_a_result_that_arrives_after_its_reservation_was_closed_is_not_recorded"]),
    ("customer contact cap read dropped from policy facts", EX,
     'facts["contacts_today"] = contacts + planned_contacts', 'facts["contacts_today"] = planned_contacts',
     [f"{T}::test_the_daily_contact_cap_holds_across_a_customers_cases_executed_in_parallel"]),
    ("scan registry advisory lock removed", PG,
     'cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (_SCAN_REGISTRY_LOCK,))', "pass",
     [f"{T}::test_concurrent_scans_of_the_same_source_data_create_one_run",
      f"{T}::test_concurrent_scans_of_different_data_leave_exactly_one_active_run"]),
    # Two independent layers serialize one object: the advisory lock and the row lock. Removing either alone is an
    # equivalent mutant (verified 2026-10-23: the test stays green), so this removes both.
    ("detection obligation lock removed (advisory lock and row lock)", PG,
     [('"SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"revora:obligation:{obligation_id}",)', '"SELECT 1", ()'),
      ('cur.execute("SELECT * FROM revenue_obligations WHERE obligation_id = %s FOR UPDATE", (obligation_id,))',
       'cur.execute("SELECT * FROM revenue_obligations WHERE obligation_id = %s", (obligation_id,))')],
     None,
     [f"{TI}::test_a_failure_racing_its_own_settlement_never_leaves_an_open_case_for_a_settled_object"]),
    ("optimistic version check removed from save_case", PG,
     "WHERE case_id = %s AND version = %s", "WHERE case_id = %s AND %s IS NOT NULL",
     [f"{T}::test_the_database_constraints_alone_stop_a_duplicate_effect_when_row_locking_is_bypassed",
      f"{TR}::test_a_stale_copy_cannot_overwrite_a_newer_case_even_without_the_row_lock"]),
    ("obligation creation burst fix reverted (no advisory lock, single-arbiter insert)", PG,
     [('"SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"revora:obligation:{obligation_id}",)', '"SELECT 1", ()'),
      ("VALUES (%s, %s, %s, %s, %s, %s)\n                ON CONFLICT DO NOTHING",
       "VALUES (%s, %s, %s, %s, %s, %s)\n                ON CONFLICT (obligation_id) DO NOTHING")],
     None,
     [f"{TI}::test_the_first_event_about_an_object_waits_on_that_objects_advisory_lock_before_inserting",
      f"{TI}::test_bursts_of_first_events_for_brand_new_objects_never_deadlock"]),
    # The burst test alone never failed on PostgreSQL 18.6 with the fix reverted (0/6): the deadlock needs an
    # interleaving inside one INSERT. The deterministic test above pins the guarantee that prevents it.
    ("obligation advisory lock removed (first writers no longer serialized before inserting)", PG,
     '"SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"revora:obligation:{obligation_id}",)', '"SELECT 1", ()',
     [f"{TI}::test_the_first_event_about_an_object_waits_on_that_objects_advisory_lock_before_inserting"]),
    ("deadlock no longer mapped to a typed transient error", PG,
     'if isinstance(exc, psycopg2.Error) and getattr(exc, "pgcode", None) in _TRANSIENT_SQLSTATES:',
     "if False:",
     [f"{T}::test_the_database_deadlock_is_reported_as_a_typed_transient_error_and_the_survivor_commits"]),
    ("transient retry removed from reservation", EX,
     "return run_with_retry(lambda: self._reserve(case_id, key, expected_action))",
     "return self._reserve(case_id, key, expected_action)",
     [f"{T}::test_a_transient_abort_during_reservation_is_retried_and_leaves_exactly_one_attempt"]),
    ("transient retry removed from booking the result", EX,
     "result = run_with_retry(lambda: self._complete_success(reservation, key, intervention))",
     "result = self._complete_success(reservation, key, intervention)",
     [f"{T}::test_a_transient_abort_while_booking_the_result_is_retried_not_abandoned"]),
    ("transient retry removed from detection", "backend/app/services/ingestion_service.py",
     "return run_with_retry(detect)",
     "return detect()",
     [f"{TI}::test_a_transient_abort_during_detection_is_retried_whole_and_opens_one_case"]),
    ("analysis chunk lock (lock_cases) removed", PG,
     '"SELECT * FROM recovery_cases WHERE run_id = %s AND transaction_id = ANY(%s) ORDER BY ordinal FOR UPDATE"',
     '"SELECT * FROM recovery_cases WHERE run_id = %s AND transaction_id = ANY(%s) ORDER BY ordinal"',
     [f"{T}::test_an_execution_waits_for_an_analysis_that_holds_its_case_and_then_sees_the_refreshed_decision"]),
]


def main(filters):
    results, failed = [], False
    for name, path, old, new, tests in MUTATIONS:
        if filters and not any(f in name for f in filters):
            continue
        original = Path(path).read_text(encoding="utf-8")
        backup = Path(path + ".mutation_backup")
        shutil.copy(path, backup)
        try:
            pairs = old if isinstance(old, list) else [(old, new)]
            mutated, problem = original, None
            for before, after in pairs:
                if mutated.count(before) != 1:
                    problem = f"MUTATION DID NOT APPLY (found {mutated.count(before)} matches for {before[:50]!r}): update this tool"
                    break
                mutated = mutated.replace(before, after)
            if problem:
                results.append((name, problem))
                failed = True
                continue
            Path(path).write_text(mutated, encoding="utf-8", newline="")
            proc = subprocess.run(
                [sys.executable, "-m", "pytest", *tests, "-p", "no:cacheprovider", "-q", "-W", "ignore", "--no-header"],
                capture_output=True, text=True, timeout=900,
            )
            tail = [line for line in proc.stdout.strip().splitlines() if line.strip()][-1:]
            caught = proc.returncode != 0
            failed = failed or not caught
            results.append((name, ("CAUGHT" if caught else "NOT CAUGHT - the tests still pass!") + (f": {tail[0]}" if tail else "")))
        finally:
            shutil.copy(backup, path)
            backup.unlink()
            assert Path(path).read_text(encoding="utf-8") == original, f"restoring {path} failed"
    for name, verdict in results:
        print(f"- {name}\n    -> {verdict}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
