-- 0002: provider-agnostic event ingestion.
--
--   source_events      normalized, validated events; one row per (merchant, source, source_event_id)
--   source_event_raw   the provider payload as received, kept apart from the normalized fields
--   revenue_obligations the projection of all events about one payment / billing cycle / invoice,
--                       linked to the recovery case detection opened for it
--
-- Also extends migration 0001: a new run kind (events open cases in an inert "ingestion" run) and
-- a new terminal case state (the source reported the obligation settled or voided).

-- ── runs: a second kind that is never active ────────────────────────────────────────────────
ALTER TABLE scan_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'synthetic_scan';
ALTER TABLE scan_runs ADD CONSTRAINT scan_runs_kind_check CHECK (kind IN ('synthetic_scan', 'ingestion'));
ALTER TABLE scan_runs DROP CONSTRAINT scan_runs_status_check;
ALTER TABLE scan_runs ADD CONSTRAINT scan_runs_status_check CHECK (status IN ('active', 'superseded', 'standby'));
-- Event-derived cases are not surfaced as the active run and so are never executable. Relax this
-- only together with a product decision on how live cases reach the dashboard.
ALTER TABLE scan_runs ADD CONSTRAINT scan_runs_ingestion_is_standby CHECK (kind <> 'ingestion' OR status = 'standby');
ALTER TABLE scan_runs ADD CONSTRAINT scan_runs_scan_is_not_standby CHECK (kind <> 'synthetic_scan' OR status <> 'standby');

-- ── cases: resolved at source ───────────────────────────────────────────────────────────────
ALTER TABLE recovery_cases DROP CONSTRAINT recovery_cases_state_check;
ALTER TABLE recovery_cases ADD CONSTRAINT recovery_cases_state_check CHECK (state IN
    ('open', 'authorized', 'blocked', 'executing', 'recovered', 'attempted_no_recovery', 'suppressed', 'escalated',
     'resolved_at_source'));

-- ── events ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE source_events (
    seq                  BIGINT GENERATED ALWAYS AS IDENTITY,
    -- Derived from (merchant_id, source, source_event_id): stable across redelivery, replay and restore.
    event_id             TEXT PRIMARY KEY,
    -- Whatever the sender CLAIMED. There is no authentication in this build, so every row says so;
    -- an authenticated ingestion path will record 'authenticated'. Never use this column to
    -- authorize anything while it reads 'unauthenticated_claim'.
    merchant_id          TEXT NOT NULL CHECK (char_length(merchant_id) BETWEEN 1 AND 128),
    merchant_assertion   TEXT NOT NULL DEFAULT 'unauthenticated_claim'
                             CHECK (merchant_assertion IN ('unauthenticated_claim', 'authenticated')),
    source               TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 64),
    source_event_id      TEXT NOT NULL CHECK (char_length(source_event_id) BETWEEN 1 AND 255),
    event_type           TEXT NOT NULL CHECK (event_type IN (
                             'payment.attempt_failed', 'payment.attempt_succeeded',
                             'checkout.started', 'checkout.abandoned',
                             'subscription.payment_failed', 'subscription.payment_succeeded',
                             'invoice.issued', 'invoice.overdue', 'invoice.paid', 'invoice.voided')),
    reference_kind       TEXT NOT NULL CHECK (reference_kind IN ('payment', 'subscription_cycle', 'invoice', 'checkout')),
    reference_id         TEXT NOT NULL CHECK (char_length(reference_id) BETWEEN 1 AND 255),
    customer_ref         TEXT,
    -- Integer minor units (paise). Never a float.
    amount_minor         BIGINT CHECK (amount_minor IS NULL OR amount_minor >= 0),
    currency             CHAR(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    payload              JSONB NOT NULL,
    -- sha256 of the canonical normalized content: the same identity with different content is a conflict.
    content_fingerprint  TEXT NOT NULL,
    occurred_at          TIMESTAMPTZ NOT NULL,
    received_at          TIMESTAMPTZ NOT NULL,
    processing_status    TEXT NOT NULL DEFAULT 'received'
                             CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
    failure_reason       TEXT,
    processed_at         TIMESTAMPTZ,
    -- Deduplication of redelivered webhooks is the database's job, not a best-effort lookup.
    CONSTRAINT source_events_identity_key UNIQUE (merchant_id, source, source_event_id),
    CONSTRAINT source_events_amount_has_currency CHECK ((amount_minor IS NULL) = (currency IS NULL)),
    CONSTRAINT source_events_failed_has_reason CHECK (processing_status <> 'failed' OR failure_reason IS NOT NULL)
);
CREATE INDEX source_events_reference ON source_events (merchant_id, reference_kind, reference_id, occurred_at);
CREATE INDEX source_events_status ON source_events (processing_status, seq);
CREATE INDEX source_events_recent ON source_events (seq DESC);

CREATE TABLE source_event_raw (
    event_id     TEXT PRIMARY KEY REFERENCES source_events (event_id),
    payload      JSONB NOT NULL,
    stored_at    TIMESTAMPTZ NOT NULL
);

-- ── obligations ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE revenue_obligations (
    obligation_id             TEXT PRIMARY KEY,
    merchant_id               TEXT NOT NULL,
    reference_kind            TEXT NOT NULL CHECK (reference_kind IN ('payment', 'subscription_cycle', 'invoice', 'checkout')),
    reference_id              TEXT NOT NULL,
    leak_type                 TEXT NOT NULL CHECK (leak_type IN
                                  ('failed_payment', 'abandoned_checkout', 'failed_subscription', 'overdue_invoice')),
    status                    TEXT NOT NULL DEFAULT 'observed' CHECK (status IN ('observed', 'at_risk', 'settled', 'void')),
    customer_ref              TEXT,
    amount_minor              BIGINT CHECK (amount_minor IS NULL OR amount_minor >= 0),
    currency                  CHAR(3),
    failure_count             INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    reported_attempt_number   INTEGER,
    consecutive_failures      INTEGER,
    latest_failure_code       TEXT,
    payment_method            TEXT,
    first_at_risk_at          TIMESTAMPTZ,
    last_at_risk_at           TIMESTAMPTZ,
    due_at                    TIMESTAMPTZ,
    settled_at                TIMESTAMPTZ,
    event_count               INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
    last_event_at             TIMESTAMPTZ,
    run_id                    TEXT REFERENCES scan_runs (run_id),
    case_id                   TEXT REFERENCES recovery_cases (case_id),
    settled_while_frozen      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                TIMESTAMPTZ NOT NULL,
    last_evaluated_at         TIMESTAMPTZ,
    -- One obligation per object per merchant, so concurrent events about it meet on one row.
    CONSTRAINT obligations_reference_key UNIQUE (merchant_id, reference_kind, reference_id),
    -- One case per obligation, and a case belongs to at most one obligation: the database
    -- is what stops duplicate or out-of-order events from fanning out into duplicate cases.
    CONSTRAINT obligations_one_case UNIQUE (case_id),
    CONSTRAINT obligations_case_has_run CHECK (case_id IS NULL OR run_id IS NOT NULL)
);
CREATE INDEX obligations_status ON revenue_obligations (merchant_id, status);
