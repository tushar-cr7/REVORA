-- 0001: core recovery model — scan runs, transactions, cases, decisions, the attempt ledger,
-- interventions, idempotency records, audit events.
--
-- Conventions
--   * Money is NUMERIC(16,2): exact, two decimals. The repository refuses a value it would have
--     to round (see MoneyPrecisionError); it never rounds silently.
--   * Model outputs (probabilities, expected values) are DOUBLE PRECISION: they are derived
--     estimates, not ledger money, and round-trip exactly.
--   * Timestamps are TIMESTAMPTZ, always UTC. Transactions.event_time stays TEXT: it is an opaque
--     source string and must read back exactly as it was written.
--   * `seq` identity columns give a deterministic insertion order where the API relies on one.
--   * Nothing here cascades a delete. History is never removed by a parent row going away.
--   * Unqualified names: the migration runs inside whichever schema the connection's
--     search_path selects (the default schema, or a per-test schema).

CREATE TABLE scan_runs (
    seq                 BIGINT GENERATED ALWAYS AS IDENTITY,
    run_id              TEXT PRIMARY KEY,
    merchant_id         TEXT NOT NULL,
    source_fingerprint  TEXT NOT NULL,
    n_total             INTEGER NOT NULL CHECK (n_total >= 0),
    seed                BIGINT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL,
    last_scanned_at     TIMESTAMPTZ NOT NULL,
    scan_count          INTEGER NOT NULL DEFAULT 1 CHECK (scan_count >= 1),
    transaction_count   INTEGER NOT NULL DEFAULT 0 CHECK (transaction_count >= 0),
    total_at_risk       NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (total_at_risk >= 0),
    status              TEXT NOT NULL,
    superseded_at       TIMESTAMPTZ,
    CONSTRAINT scan_runs_status_check CHECK (status IN ('active', 'superseded')),
    CONSTRAINT scan_runs_fingerprint_key UNIQUE (source_fingerprint)
);
-- At most one active run, enforced by the database rather than by application code.
CREATE UNIQUE INDEX scan_runs_one_active ON scan_runs ((TRUE)) WHERE status = 'active';

CREATE TABLE transactions (
    run_id                     TEXT NOT NULL REFERENCES scan_runs (run_id),
    transaction_id             TEXT NOT NULL,
    ordinal                    INTEGER NOT NULL CHECK (ordinal >= 0),
    leak_id                    TEXT NOT NULL,
    merchant_id                TEXT NOT NULL,
    customer_id                TEXT NOT NULL,
    amount                     NUMERIC(16,2) NOT NULL CHECK (amount >= 0),
    leak_type                  TEXT NOT NULL CHECK (leak_type IN
                                   ('failed_payment', 'abandoned_checkout', 'failed_subscription', 'overdue_invoice')),
    payment_method             TEXT,
    failure_code               TEXT,
    prior_successful_payments  INTEGER CHECK (prior_successful_payments IS NULL OR prior_successful_payments >= 0),
    ltv_bucket                 TEXT,
    -- Safety-critical figures are nullable on purpose: unknown stays NULL and fails closed at
    -- execution. A NULL is never turned into a permissive 0.
    retries_so_far             INTEGER CHECK (retries_so_far IS NULL OR retries_so_far >= 0),
    hours_since_event          INTEGER,
    age_days                   INTEGER,
    event_time                 TEXT NOT NULL,
    merchant_segment           TEXT,
    payment_id                 TEXT,
    visit_count                INTEGER,
    reached_payment_page       BOOLEAN,
    consecutive_failures       INTEGER,
    subscription_age_days      INTEGER,
    contacts_today             INTEGER NOT NULL DEFAULT 0 CHECK (contacts_today >= 0),
    model_recovery_prob        DOUBLE PRECISION CHECK (model_recovery_prob IS NULL
                                   OR (model_recovery_prob >= 0 AND model_recovery_prob <= 1)),
    PRIMARY KEY (run_id, transaction_id),
    -- Transaction ids are only unique within a run (the generator reuses them across scans).
    CONSTRAINT transactions_leak_unique UNIQUE (run_id, leak_id)
);
CREATE INDEX transactions_run_order ON transactions (run_id, ordinal);

CREATE TABLE recovery_cases (
    case_id              TEXT PRIMARY KEY,
    run_id               TEXT NOT NULL,
    ordinal              INTEGER NOT NULL CHECK (ordinal >= 0),
    merchant_id          TEXT NOT NULL,
    transaction_id       TEXT NOT NULL,
    leak_id              TEXT NOT NULL,
    customer_id          TEXT NOT NULL,
    leak_type            TEXT NOT NULL,
    amount               NUMERIC(16,2) NOT NULL CHECK (amount >= 0),
    state                TEXT NOT NULL,
    decision_id          TEXT,
    authorized_action    TEXT CHECK (authorized_action IS NULL
                             OR authorized_action IN ('retry', 'payment_link', 'reminder', 'escalate', 'suppress')),
    authorization_snapshot JSONB,
    policy_version       TEXT,
    attempt_count        INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    active_attempt_id    TEXT,
    recovered_attempt_id TEXT,
    recovered_amount     NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (recovered_amount >= 0),
    outcome_status       TEXT,
    blocked_reason       TEXT,
    safe_alternative     TEXT,
    history              JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL,
    -- Optimistic concurrency: every update must name the version it read. Row locks are what normally
    -- serialize writers; this makes a stale write (a copy read without the lock, or before another unit
    -- committed) fail loudly instead of silently overwriting a newer state.
    version              INTEGER NOT NULL DEFAULT 0,
    -- A case is the unit of recovery: exactly one per transaction per run.
    CONSTRAINT cases_transaction_fk FOREIGN KEY (run_id, transaction_id) REFERENCES transactions (run_id, transaction_id),
    CONSTRAINT cases_one_per_transaction UNIQUE (run_id, transaction_id),
    CONSTRAINT cases_one_per_leak UNIQUE (run_id, leak_id),
    CONSTRAINT recovery_cases_state_check CHECK (state IN
        ('open', 'authorized', 'blocked', 'executing', 'recovered', 'attempted_no_recovery', 'suppressed', 'escalated')),
    -- "executing" and "an attempt is in flight" are the same fact; neither can exist without the other.
    CONSTRAINT cases_executing_has_attempt CHECK ((state = 'executing') = (active_attempt_id IS NOT NULL)),
    CONSTRAINT cases_recovered_has_attempt CHECK (state <> 'recovered' OR recovered_attempt_id IS NOT NULL),
    -- Never more recovered than was at risk.
    CONSTRAINT cases_recovered_within_amount CHECK (recovered_amount <= amount)
);
CREATE INDEX cases_run_order ON recovery_cases (run_id, ordinal);
CREATE INDEX cases_state ON recovery_cases (run_id, state);

CREATE TABLE decisions (
    decision_id               TEXT PRIMARY KEY,
    run_id                    TEXT NOT NULL REFERENCES scan_runs (run_id),
    case_id                   TEXT NOT NULL REFERENCES recovery_cases (case_id),
    leak_id                   TEXT NOT NULL,
    transaction_id            TEXT NOT NULL,
    candidates_evaluated      JSONB NOT NULL,
    ai_proposed_action        TEXT NOT NULL,
    ai_proposed_ev            DOUBLE PRECISION NOT NULL,
    ai_proposed_probability   DOUBLE PRECISION NOT NULL,
    policy_allowed            BOOLEAN NOT NULL,
    policy_reason             TEXT NOT NULL,
    final_action              TEXT NOT NULL CHECK (final_action IN ('retry', 'payment_link', 'reminder', 'escalate', 'suppress')),
    created_at                TIMESTAMPTZ NOT NULL,
    policy_version            TEXT,
    -- The PolicyLimits in force when the verdict was reached.
    policy_limits             JSONB
);
CREATE INDEX decisions_case ON decisions (case_id, created_at);
CREATE INDEX decisions_run ON decisions (run_id);

CREATE TABLE execution_attempts (
    seq                BIGINT GENERATED ALWAYS AS IDENTITY,
    attempt_id         TEXT PRIMARY KEY,
    case_id            TEXT NOT NULL REFERENCES recovery_cases (case_id),
    run_id             TEXT NOT NULL REFERENCES scan_runs (run_id),
    merchant_id        TEXT NOT NULL,
    transaction_id     TEXT NOT NULL,
    customer_id        TEXT NOT NULL,
    sequence           INTEGER NOT NULL CHECK (sequence >= 1),
    attempt_number     INTEGER CHECK (attempt_number IS NULL OR attempt_number >= 1),
    requested_action   TEXT NOT NULL,
    final_action       TEXT,
    decision_id        TEXT REFERENCES decisions (decision_id),
    -- The execution-time authorization snapshot: verdict, limits, and the inputs it was computed from.
    authorization_snapshot JSONB NOT NULL,
    status             TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'failed', 'denied')),
    idempotency_key    TEXT,
    request_fingerprint TEXT NOT NULL,
    provider           TEXT NOT NULL,
    execution_mode     TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL,
    completed_at       TIMESTAMPTZ,
    intervention_id    TEXT,
    outcome_status     TEXT,
    recovered          BOOLEAN NOT NULL DEFAULT FALSE,
    recovered_amount   NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (recovered_amount >= 0),
    failure_reason     TEXT,
    CONSTRAINT attempts_case_sequence_key UNIQUE (case_id, sequence),
    -- A denied request consumed nothing: it has neither an attempt number nor an executed action.
    CONSTRAINT attempts_denied_shape CHECK (
        (status = 'denied') = (attempt_number IS NULL) AND (status = 'denied') = (final_action IS NULL)
    ),
    CONSTRAINT attempts_recovered_only_when_completed CHECK (NOT recovered OR status = 'completed'),
    CONSTRAINT attempts_recovered_amount_matches CHECK (recovered = (recovered_amount > 0))
);
-- At most one attempt in flight per case.
CREATE UNIQUE INDEX attempts_one_in_flight_per_case ON execution_attempts (case_id) WHERE status = 'reserved';
-- Counted attempts are numbered 1..n without gaps or repeats.
CREATE UNIQUE INDEX attempts_number_key ON execution_attempts (case_id, attempt_number) WHERE attempt_number IS NOT NULL;
-- A case can be recovered at most once, whatever the callers do.
CREATE UNIQUE INDEX attempts_one_recovery_per_case ON execution_attempts (case_id) WHERE recovered;
CREATE INDEX attempts_customer ON execution_attempts (merchant_id, customer_id, created_at);
CREATE INDEX attempts_run_order ON execution_attempts (run_id, seq);
CREATE INDEX attempts_reserved ON execution_attempts (created_at) WHERE status = 'reserved';

CREATE TABLE interventions (
    seq                         BIGINT GENERATED ALWAYS AS IDENTITY,
    intervention_id             TEXT PRIMARY KEY,
    decision_id                 TEXT NOT NULL REFERENCES decisions (decision_id),
    leak_id                     TEXT NOT NULL,
    transaction_id              TEXT NOT NULL,
    customer_id                 TEXT NOT NULL,
    merchant_id                 TEXT NOT NULL,
    amount                      NUMERIC(16,2) NOT NULL CHECK (amount >= 0),
    ai_proposed_action          TEXT NOT NULL,
    policy_allowed              BOOLEAN NOT NULL,
    policy_reason               TEXT NOT NULL,
    final_action                TEXT NOT NULL,
    provider                    TEXT NOT NULL,
    status                      TEXT NOT NULL,
    recovered                   BOOLEAN NOT NULL,
    recovered_amount            NUMERIC(16,2) NOT NULL CHECK (recovered_amount >= 0),
    occurred_at                 TIMESTAMPTZ NOT NULL,
    execution_probability_used  DOUBLE PRECISION,
    idempotency_key             TEXT,
    run_id                      TEXT NOT NULL REFERENCES scan_runs (run_id),
    case_id                     TEXT NOT NULL REFERENCES recovery_cases (case_id),
    -- One intervention per attempt: a replay can never mint a second record.
    attempt_id                  TEXT NOT NULL REFERENCES execution_attempts (attempt_id),
    execution_mode              TEXT,
    CONSTRAINT interventions_one_per_attempt UNIQUE (attempt_id),
    CONSTRAINT interventions_recovered_amount_matches CHECK (recovered = (recovered_amount > 0)),
    CONSTRAINT interventions_recovered_within_amount CHECK (recovered_amount <= amount)
);
-- ...and at most one recovered intervention per case.
CREATE UNIQUE INDEX interventions_one_recovery_per_case ON interventions (case_id) WHERE recovered;
CREATE INDEX interventions_run_order ON interventions (run_id, seq);

-- Circular references, added once both sides exist.
ALTER TABLE recovery_cases
    ADD CONSTRAINT cases_decision_fk FOREIGN KEY (decision_id) REFERENCES decisions (decision_id),
    ADD CONSTRAINT cases_active_attempt_fk FOREIGN KEY (active_attempt_id) REFERENCES execution_attempts (attempt_id),
    ADD CONSTRAINT cases_recovered_attempt_fk FOREIGN KEY (recovered_attempt_id) REFERENCES execution_attempts (attempt_id);
ALTER TABLE execution_attempts
    ADD CONSTRAINT attempts_intervention_fk FOREIGN KEY (intervention_id) REFERENCES interventions (intervention_id);

CREATE TABLE idempotency_records (
    merchant_id          TEXT NOT NULL,
    operation            TEXT NOT NULL,
    key                  TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 255),
    request_fingerprint  TEXT NOT NULL,
    case_id              TEXT NOT NULL REFERENCES recovery_cases (case_id),
    attempt_id           TEXT NOT NULL REFERENCES execution_attempts (attempt_id),
    status               TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
    http_status          INTEGER,
    response             JSONB,
    created_at           TIMESTAMPTZ NOT NULL,
    completed_at         TIMESTAMPTZ,
    -- The scope of an idempotency key. The database, not a process-local lock, is what makes
    -- "the same key twice" a conflict.
    PRIMARY KEY (merchant_id, operation, key),
    CONSTRAINT idempotency_completed_has_status CHECK ((status = 'completed') = (http_status IS NOT NULL))
);
CREATE INDEX idempotency_case ON idempotency_records (case_id);

CREATE TABLE audit_events (
    seq              BIGINT GENERATED ALWAYS AS IDENTITY,
    event_id         TEXT PRIMARY KEY,
    merchant_id      TEXT NOT NULL,
    transaction_id   TEXT NOT NULL,
    leak_id          TEXT NOT NULL,
    decision_id      TEXT REFERENCES decisions (decision_id),
    intervention_id  TEXT REFERENCES interventions (intervention_id),
    occurred_at      TIMESTAMPTZ NOT NULL,
    event_type       TEXT NOT NULL,
    action           TEXT NOT NULL,
    policy_result    JSONB NOT NULL,
    policy_version   TEXT NOT NULL,
    model_version    TEXT NOT NULL,
    provider         TEXT NOT NULL,
    outcome          JSONB,
    correlation_id   TEXT,
    idempotency_key  TEXT,
    run_id           TEXT REFERENCES scan_runs (run_id),
    case_id          TEXT REFERENCES recovery_cases (case_id),
    attempt_id       TEXT REFERENCES execution_attempts (attempt_id)
);
CREATE INDEX audit_run_order ON audit_events (run_id, seq);
CREATE INDEX audit_transaction ON audit_events (transaction_id, seq);
CREATE INDEX audit_case ON audit_events (case_id, seq);
CREATE INDEX audit_attempt ON audit_events (attempt_id);
CREATE INDEX audit_type ON audit_events (event_type);

-- Guard against accidental edits: audit rows are appended, never changed or removed, by this
-- application. This is NOT tamper-evidence — a database superuser or the table owner can drop
-- the trigger — and nothing here hashes or signs the rows.
CREATE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only (% rejected)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_change
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
