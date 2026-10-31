-- 0004: workspace isolation (Phase 3.1).
--
--   1. The single global "active run" becomes one active run PER WORKSPACE.
--   2. Child rows can no longer claim a workspace other than their parent run's, and every workspace id in the
--      schema must be a registered workspace (composite foreign keys, named ws_*).
--   3. A database trigger refuses to start an execution attempt in a workspace that is not `simulation`.
--
-- A workspace is identified by `merchant_id` (the column keeps its name; see 0003). The ownership chain is
--   workspaces -> scan_runs -> { transactions, recovery_cases -> { decisions, execution_attempts -> interventions } }
-- and this migration makes the database enforce every link of it that the schema already expresses.
--
-- What it checks first. Every constraint below is validated against the EXISTING rows before anything is changed.
-- If any row would violate one, the migration stops (and rolls back whole) with a message naming the invariant and
-- up to five offending rows. It never deletes, rewrites or reassigns a row to make a constraint pass: a record that
-- names the wrong workspace is a fact someone has to look at. The only data change is a label repair: scan_runs
-- whose workspace was registered AFTER the run was created (migration 0003 left such labels NULL) get the kind the
-- registry records.
--
-- Deliberately NOT constrained
--   * source_events has no run or case: it is tied to the registry only (a registered workspace).
--   * decisions carry no workspace column; they are tied to their case and run, and through the case to the workspace.
--   * audit_events written without a run or case (none are produced today) are tied to the registry only.
--   * `merchant_id` is still an unauthenticated claim at the API edge. These constraints make stored data
--     self-consistent; they do not prove who is calling. See docs/PHASE_3_CHECKPOINT.md.

-- ── diagnostics ─────────────────────────────────────────────────────────────────────────────
-- Temporary (pg_temp): exists only for this session and leaves nothing behind in the schema.
CREATE FUNCTION pg_temp.revora_require_none(invariant text, offenders_sql text, remedy text) RETURNS void AS $fn$
DECLARE
    n      bigint;
    sample text;
BEGIN
    EXECUTE 'SELECT count(*) FROM (' || offenders_sql || ') AS q(o)' INTO n;
    IF n > 0 THEN
        EXECUTE 'SELECT string_agg(o, '' | '') FROM (SELECT o FROM (' || offenders_sql || ') AS q(o) LIMIT 5) AS s(o)' INTO sample;
        RAISE EXCEPTION 'Migration 0004 cannot be applied: % existing row(s) violate the rule "%". Examples: %. % Nothing was changed; fix these rows deliberately, then run the upgrade again.',
            n, invariant, sample, remedy
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
END;
$fn$ LANGUAGE plpgsql;

-- Label repair (see above): derive the kind from the registry for runs that were created before their workspace was.
UPDATE scan_runs r SET workspace_kind = w.kind
FROM workspaces w
WHERE r.workspace_kind IS NULL AND w.workspace_id = r.merchant_id;

-- ── pre-checks: every existing row must already satisfy what is about to be enforced ──────────
SELECT pg_temp.revora_require_none(
    'every scan run belongs to a registered workspace',
    $q$SELECT format('run %s (%s) names unregistered workspace %L', run_id, kind, merchant_id)
       FROM scan_runs WHERE workspace_kind IS NULL$q$,
    'These runs came from event claims about workspaces that were never registered (Phase 3.0 accepted them). '
    'Register the workspace deliberately if it is real; REVORA will not create it from an unauthenticated claim.');
SELECT pg_temp.revora_require_none(
    'every source event belongs to a registered workspace',
    $q$SELECT format('event %s claims unregistered workspace %L', e.event_id, e.merchant_id)
       FROM source_events e WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.workspace_id = e.merchant_id)$q$,
    'These are events claimed for workspaces that were never registered. Register the workspace deliberately if it is real.');
SELECT pg_temp.revora_require_none(
    'every audit event belongs to a registered workspace',
    $q$SELECT format('audit event %s names unregistered workspace %L', e.event_id, e.merchant_id)
       FROM audit_events e WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.workspace_id = e.merchant_id)$q$,
    'Register the workspace deliberately if it is real.');
SELECT pg_temp.revora_require_none(
    'every revenue obligation belongs to a registered workspace',
    $q$SELECT format('obligation %s names unregistered workspace %L', o.obligation_id, o.merchant_id)
       FROM revenue_obligations o WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.workspace_id = o.merchant_id)$q$,
    'Register the workspace deliberately if it is real.');

SELECT pg_temp.revora_require_none(
    'a transaction belongs to the workspace of its run',
    $q$SELECT format('transaction %s/%s claims workspace %L, its run belongs to %L', t.run_id, t.transaction_id, t.merchant_id, r.merchant_id)
       FROM transactions t JOIN scan_runs r ON r.run_id = t.run_id WHERE t.merchant_id <> r.merchant_id$q$,
    'A record claims a different workspace than the run that holds it.');
SELECT pg_temp.revora_require_none(
    'a recovery case belongs to the workspace of its run',
    $q$SELECT format('case %s claims workspace %L, its run %s belongs to %L', c.case_id, c.merchant_id, c.run_id, r.merchant_id)
       FROM recovery_cases c JOIN scan_runs r ON r.run_id = c.run_id WHERE c.merchant_id <> r.merchant_id$q$,
    'A record claims a different workspace than the run that holds it.');
SELECT pg_temp.revora_require_none(
    'a decision belongs to the run of its case',
    $q$SELECT format('decision %s is in run %s, its case %s is in run %s', d.decision_id, d.run_id, d.case_id, c.run_id)
       FROM decisions d JOIN recovery_cases c ON c.case_id = d.case_id WHERE d.run_id <> c.run_id$q$,
    'A decision names a different run than the case it was made for.');
SELECT pg_temp.revora_require_none(
    'an execution attempt belongs to the workspace and run of its case',
    $q$SELECT format('attempt %s: workspace %L, run %s; its case %s: workspace %L, run %s', a.attempt_id, a.merchant_id, a.run_id, c.case_id, c.merchant_id, c.run_id)
       FROM execution_attempts a JOIN recovery_cases c ON c.case_id = a.case_id
       WHERE a.merchant_id <> c.merchant_id OR a.run_id <> c.run_id$q$,
    'An attempt names a different workspace or run than the case it was made for.');
SELECT pg_temp.revora_require_none(
    'an intervention belongs to the workspace and run of its case, and the workspace of its attempt',
    $q$SELECT format('intervention %s: workspace %L, run %s; case %s: workspace %L, run %s; attempt %s: workspace %L', i.intervention_id, i.merchant_id, i.run_id, c.case_id, c.merchant_id, c.run_id, a.attempt_id, a.merchant_id)
       FROM interventions i
       JOIN recovery_cases c ON c.case_id = i.case_id
       JOIN execution_attempts a ON a.attempt_id = i.attempt_id
       WHERE i.merchant_id <> c.merchant_id OR i.run_id <> c.run_id OR i.merchant_id <> a.merchant_id$q$,
    'An intervention names a different workspace or run than the case or attempt it records.');
SELECT pg_temp.revora_require_none(
    'an idempotency record belongs to the workspace of its case and attempt',
    $q$SELECT format('idempotency record %s/%s/%s: workspace %L; case %s: %L; attempt %s: %L', r.merchant_id, r.operation, r.key, r.merchant_id, c.case_id, c.merchant_id, a.attempt_id, a.merchant_id)
       FROM idempotency_records r
       JOIN recovery_cases c ON c.case_id = r.case_id
       JOIN execution_attempts a ON a.attempt_id = r.attempt_id
       WHERE r.merchant_id <> c.merchant_id OR r.merchant_id <> a.merchant_id$q$,
    'An idempotency record names a different workspace than the case or attempt it protects.');
SELECT pg_temp.revora_require_none(
    'an audit event belongs to the workspace of its run, case and attempt',
    $q$SELECT format('audit event %s: workspace %L; run %s: %L; case %s: %L; attempt %s: %L', e.event_id, e.merchant_id, r.run_id, r.merchant_id, c.case_id, c.merchant_id, a.attempt_id, a.merchant_id)
       FROM audit_events e
       LEFT JOIN scan_runs r ON r.run_id = e.run_id
       LEFT JOIN recovery_cases c ON c.case_id = e.case_id
       LEFT JOIN execution_attempts a ON a.attempt_id = e.attempt_id
       WHERE e.merchant_id <> COALESCE(r.merchant_id, e.merchant_id)
          OR e.merchant_id <> COALESCE(c.merchant_id, e.merchant_id)
          OR e.merchant_id <> COALESCE(a.merchant_id, e.merchant_id)$q$,
    'An audit event names a different workspace than the run, case or attempt it records.');
SELECT pg_temp.revora_require_none(
    'a revenue obligation belongs to the workspace of its run and case',
    $q$SELECT format('obligation %s: workspace %L; run %s: %L; case %s: %L', o.obligation_id, o.merchant_id, r.run_id, r.merchant_id, c.case_id, c.merchant_id)
       FROM revenue_obligations o
       LEFT JOIN scan_runs r ON r.run_id = o.run_id
       LEFT JOIN recovery_cases c ON c.case_id = o.case_id
       WHERE o.merchant_id <> COALESCE(r.merchant_id, o.merchant_id)
          OR o.merchant_id <> COALESCE(c.merchant_id, o.merchant_id)$q$,
    'An obligation names a different workspace than the run or case opened for it.');

-- ── 1. one active run per workspace ─────────────────────────────────────────────────────────
-- The old index allowed ONE active run in the whole database, so a scan in one workspace superseded every other
-- workspace's run. A partial unique index on the workspace id is the whole invariant: at most one active run each.
DROP INDEX scan_runs_one_active;
CREATE UNIQUE INDEX scan_runs_one_active_per_workspace ON scan_runs (merchant_id) WHERE status = 'active';

-- Every run names a registered workspace: no more NULL labels (0003 allowed them for unregistered event claims).
ALTER TABLE scan_runs ALTER COLUMN workspace_kind SET NOT NULL;

-- ── 2. ownership: composite keys, then composite foreign keys ───────────────────────────────
-- Targets. (A primary key already makes each id unique; these add the workspace / run it belongs to, so a child can
-- reference BOTH and the database compares them.)
ALTER TABLE scan_runs ADD CONSTRAINT scan_runs_run_workspace_key UNIQUE (run_id, merchant_id);
ALTER TABLE recovery_cases
    ADD CONSTRAINT cases_case_run_key UNIQUE (case_id, run_id),
    ADD CONSTRAINT cases_case_workspace_key UNIQUE (case_id, merchant_id);
ALTER TABLE execution_attempts ADD CONSTRAINT attempts_attempt_workspace_key UNIQUE (attempt_id, merchant_id);

-- Rows that sit under a run must name that run's workspace.
ALTER TABLE transactions
    ADD CONSTRAINT ws_transactions_run_fk FOREIGN KEY (run_id, merchant_id) REFERENCES scan_runs (run_id, merchant_id);
ALTER TABLE recovery_cases
    ADD CONSTRAINT ws_cases_run_fk FOREIGN KEY (run_id, merchant_id) REFERENCES scan_runs (run_id, merchant_id);
ALTER TABLE decisions
    ADD CONSTRAINT ws_decisions_case_run_fk FOREIGN KEY (case_id, run_id) REFERENCES recovery_cases (case_id, run_id);
ALTER TABLE execution_attempts
    ADD CONSTRAINT ws_attempts_run_fk FOREIGN KEY (run_id, merchant_id) REFERENCES scan_runs (run_id, merchant_id),
    ADD CONSTRAINT ws_attempts_case_run_fk FOREIGN KEY (case_id, run_id) REFERENCES recovery_cases (case_id, run_id);
ALTER TABLE interventions
    ADD CONSTRAINT ws_interventions_run_fk FOREIGN KEY (run_id, merchant_id) REFERENCES scan_runs (run_id, merchant_id),
    ADD CONSTRAINT ws_interventions_case_run_fk FOREIGN KEY (case_id, run_id) REFERENCES recovery_cases (case_id, run_id),
    ADD CONSTRAINT ws_interventions_attempt_fk FOREIGN KEY (attempt_id, merchant_id) REFERENCES execution_attempts (attempt_id, merchant_id);
ALTER TABLE idempotency_records
    ADD CONSTRAINT ws_idempotency_case_fk FOREIGN KEY (case_id, merchant_id) REFERENCES recovery_cases (case_id, merchant_id),
    ADD CONSTRAINT ws_idempotency_attempt_fk FOREIGN KEY (attempt_id, merchant_id) REFERENCES execution_attempts (attempt_id, merchant_id);

-- Rows with an optional run / case / attempt: when it is set (MATCH SIMPLE skips a NULL), the workspace must agree.
ALTER TABLE audit_events
    ADD CONSTRAINT ws_audit_workspace_fk FOREIGN KEY (merchant_id) REFERENCES workspaces (workspace_id),
    ADD CONSTRAINT ws_audit_run_fk FOREIGN KEY (run_id, merchant_id) REFERENCES scan_runs (run_id, merchant_id),
    ADD CONSTRAINT ws_audit_case_fk FOREIGN KEY (case_id, merchant_id) REFERENCES recovery_cases (case_id, merchant_id),
    ADD CONSTRAINT ws_audit_attempt_fk FOREIGN KEY (attempt_id, merchant_id) REFERENCES execution_attempts (attempt_id, merchant_id);
ALTER TABLE revenue_obligations
    ADD CONSTRAINT ws_obligations_workspace_fk FOREIGN KEY (merchant_id) REFERENCES workspaces (workspace_id),
    ADD CONSTRAINT ws_obligations_run_fk FOREIGN KEY (run_id, merchant_id) REFERENCES scan_runs (run_id, merchant_id),
    ADD CONSTRAINT ws_obligations_case_fk FOREIGN KEY (case_id, merchant_id) REFERENCES recovery_cases (case_id, merchant_id);

-- Events belong to a REGISTERED workspace; an event about an unknown workspace is refused, never stored.
ALTER TABLE source_events
    ADD CONSTRAINT ws_source_events_workspace_fk FOREIGN KEY (merchant_id) REFERENCES workspaces (workspace_id);

-- Reads are per workspace now.
CREATE INDEX audit_workspace_order ON audit_events (merchant_id, seq);
CREATE INDEX source_events_workspace_order ON source_events (merchant_id, seq DESC);

-- ── 3. nothing executes outside a `simulation` workspace ────────────────────────────────────
-- Defence in depth behind ExecutionService: even a caller that skips the service cannot start an attempt (reserved,
-- completed or failed) for a workspace whose execution_mode is not 'simulation' (a merchant workspace is
-- 'recommend_only' by constraint). A DENIED attempt is only the record of a refusal and is always allowed.
-- Closing an attempt that already exists is never blocked: switching a workspace off mid-flight must not strand it.
CREATE FUNCTION execution_attempts_require_executable_workspace() RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'denied' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status <> 'denied' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM execution_attempts WHERE attempt_id = NEW.attempt_id) THEN
        RETURN NEW;  -- an upsert of an attempt that already counted (its completion), not a new one
    END IF;
    IF NOT EXISTS (SELECT 1 FROM workspaces WHERE workspace_id = NEW.merchant_id AND execution_mode = 'simulation') THEN
        RAISE EXCEPTION 'ws_execution_not_available: workspace % does not allow execution (attempt % would be %)',
            NEW.merchant_id, NEW.attempt_id, NEW.status
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER execution_attempts_executable_workspace
    BEFORE INSERT OR UPDATE OF status, merchant_id ON execution_attempts
    FOR EACH ROW EXECUTE FUNCTION execution_attempts_require_executable_workspace();
