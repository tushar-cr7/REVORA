-- 0003: workspaces — the tenant boundary that demo data and merchant data are kept apart by (Phase 3.0).
--
--   workspaces   one row per workspace. 'demo': synthetic data may be generated, execution is simulated.
--                'merchant': real records — synthetic data is never generated in it and it can never use
--                simulated execution (a simulated outcome on real records would be a fabricated result).
--
-- Also extends scan_runs: every run carries its workspace's kind, DERIVED by the database from this
-- registry, so the database itself refuses a synthetic scan run anywhere but in a registered demo workspace.
-- The existing `merchant_id` columns keep their name and hold the workspace id.
--
-- Backfill. Workspaces did not exist before this migration, so every workspace id already present in the
-- data is registered, from EVERY table that carries one: scan_runs, transactions, recovery_cases,
-- execution_attempts, interventions, idempotency_records, audit_events, source_events, revenue_obligations
-- (decisions and source_event_raw carry none). Each becomes a DEMO workspace with origin
-- 'pre_phase3_backfill': before Phase 3 only synthetic data and synthetic fixtures could exist — no real
-- merchant data or provider was ever connected — so no id is promoted to a merchant workspace by assumption.
-- base_currency 'INR' because every case before Phase 3 is INR-only; timezone 'UTC' because no timezone was
-- ever recorded (all timestamps are stored in UTC). The documented demo workspace 'merch_001' (the default of
-- POST /api/scan) is then seeded if the data did not already contain it.
--
-- Not covered yet (next increment): reads are not scoped by workspace, the active run is still global,
-- child rows (transactions, cases, ...) are not tied to their run's workspace, and an ingestion run for an
-- id that was never registered is still accepted with workspace_kind NULL (events are unauthenticated
-- claims and their cases are inert). Nothing here is authentication.

CREATE TABLE workspaces (
    seq             BIGINT GENERATED ALWAYS AS IDENTITY,
    workspace_id    TEXT PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN ('demo', 'merchant')),
    display_name    TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
    base_currency   CHAR(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    timezone        TEXT NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 64),
    execution_mode  TEXT NOT NULL CHECK (execution_mode IN ('simulation', 'recommend_only')),
    origin          TEXT NOT NULL CHECK (origin IN ('pre_phase3_backfill', 'demo_seed', 'explicit')),
    created_at      TIMESTAMPTZ NOT NULL,
    -- The shape the ingestion contract already accepts for a merchant claim. Ids found in pre-existing data
    -- are registered exactly as they are: refusing one would block upgrading a database that holds it.
    CONSTRAINT workspaces_id_shape CHECK (
        origin = 'pre_phase3_backfill'
        OR (char_length(workspace_id) BETWEEN 1 AND 128 AND workspace_id !~ '[[:cntrl:]]')
    ),
    -- Target of scan_runs' composite foreign key: a run states its workspace's kind and this proves it.
    CONSTRAINT workspaces_kind_key UNIQUE (workspace_id, kind),
    -- Real records are never given a simulated outcome.
    CONSTRAINT workspaces_merchant_never_simulates CHECK (kind = 'demo' OR execution_mode = 'recommend_only')
);

-- ── backfill ────────────────────────────────────────────────────────────────────────────────
INSERT INTO workspaces (workspace_id, kind, display_name, base_currency, timezone, execution_mode, origin, created_at)
SELECT found.merchant_id, 'demo', left('Backfilled: ' || found.merchant_id, 200), 'INR', 'UTC', 'simulation',
       'pre_phase3_backfill', now()
FROM (
    SELECT merchant_id FROM scan_runs
    UNION SELECT merchant_id FROM transactions
    UNION SELECT merchant_id FROM recovery_cases
    UNION SELECT merchant_id FROM execution_attempts
    UNION SELECT merchant_id FROM interventions
    UNION SELECT merchant_id FROM idempotency_records
    UNION SELECT merchant_id FROM audit_events
    UNION SELECT merchant_id FROM source_events
    UNION SELECT merchant_id FROM revenue_obligations
) AS found
ORDER BY found.merchant_id;

INSERT INTO workspaces (workspace_id, kind, display_name, base_currency, timezone, execution_mode, origin, created_at)
VALUES ('merch_001', 'demo', 'REVORA demo workspace', 'INR', 'UTC', 'simulation', 'demo_seed', now())
ON CONFLICT (workspace_id) DO NOTHING;

-- ── workspaces are permanent ────────────────────────────────────────────────────────────────
-- Identity, kind, origin and creation time never change, and a workspace is never deleted: deleting and
-- re-inserting it would be a way to change its kind. (Like the audit trigger, this guards against mistakes;
-- the table owner can drop it.)
CREATE FUNCTION workspaces_immutable() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'workspaces are never deleted (workspace %)', OLD.workspace_id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.origin IS DISTINCT FROM OLD.origin OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'workspace %: workspace_id, kind, origin and created_at cannot be changed', OLD.workspace_id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspaces_no_change
    BEFORE UPDATE OR DELETE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION workspaces_immutable();

-- ── runs belong to a workspace ──────────────────────────────────────────────────────────────
ALTER TABLE scan_runs ADD COLUMN workspace_kind TEXT;
UPDATE scan_runs r SET workspace_kind = w.kind FROM workspaces w WHERE w.workspace_id = r.merchant_id;

-- The kind is never taken from the caller: it is looked up in the registry on every insert and on every change
-- of the run's workspace. An unregistered id yields NULL, which only an ingestion run may have (see below).
CREATE FUNCTION scan_runs_derive_workspace_kind() RETURNS trigger AS $$
BEGIN
    NEW.workspace_kind := (SELECT kind FROM workspaces WHERE workspace_id = NEW.merchant_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scan_runs_workspace_kind
    BEFORE INSERT OR UPDATE OF merchant_id, workspace_kind ON scan_runs
    FOR EACH ROW EXECUTE FUNCTION scan_runs_derive_workspace_kind();

-- Defence in depth behind the trigger: a stated kind must be the workspace's real kind. (A NULL kind skips
-- this check, which is why the synthetic-scan rules below also require it to be present.)
ALTER TABLE scan_runs ADD CONSTRAINT scan_runs_workspace_fk
    FOREIGN KEY (merchant_id, workspace_kind) REFERENCES workspaces (workspace_id, kind);
-- Synthetic demo data exists only in a registered demo workspace.
ALTER TABLE scan_runs ADD CONSTRAINT scan_runs_synthetic_has_workspace
    CHECK (kind <> 'synthetic_scan' OR workspace_kind IS NOT NULL);
ALTER TABLE scan_runs ADD CONSTRAINT scan_runs_synthetic_only_in_demo
    CHECK (kind <> 'synthetic_scan' OR workspace_kind = 'demo');
