# Recovery Controls ("/policies") — rollback backup

Taken 2026-09-20, before rebuilding Recovery Controls into a "Recovery
Authority" safety/control-center surface. Frontend visual/UX only — no
backend, API, or policy-engine changes. `backend/app/domain/policy.py` was
read for reference only, never modified.

## To restore ("NAHH — RESTORE")

Copy the file below back to its original path.

| Backup path | Restore to |
|---|---|
| `app/(dashboard)/policies/page.tsx` | `frontend/app/(dashboard)/policies/page.tsx` |

Then delete the new files this round adds (they did not exist before):

- `frontend/components/recovery-controls/RecoveryBoundaryPanel.tsx`
- `frontend/components/recovery-controls/ActionPermissions.tsx`
- `frontend/components/recovery-controls/ControlGroups.tsx`

No other files were changed. Nothing in `frontend/lib/` was modified — the
round reuses `actionMeta.ts` and `format.ts` as-is.

## Real data model this round is honest about

- `GET /api/policies` returns `{ active_policy, policy_version,
  description }` — a **read-only** snapshot of `DEFAULT_POLICY` from
  `backend/app/domain/policy.py`. There is no `PUT`/`PATCH /api/policies`
  endpoint anywhere in `backend/app/api/routes.py`, so this round does not
  add any editing UI or "Saved" state — every control is presented
  read-only, explicitly labeled as enforced/non-editable.
- `POST /api/simulate` (what-if policy simulation) already exists and is
  surfaced on the **Settings** page via
  `frontend/components/simulator/RecoverySimulator.tsx`. This round does
  not duplicate that feature or touch Settings.
- "Control Status: Active" reflects only whether `GET /api/policies`
  actually loaded successfully this session — on a failed fetch the badge
  reads "Unavailable" (risk-colored), never a hardcoded "Active".
- All six numeric limits shown (`max_retries`, `min_cooldown_hours`,
  `max_customer_contacts_per_day`, `max_auto_recovery_value`,
  `max_subscription_consecutive_failures_for_retry`,
  `invoice_escalation_age_days`) are read live from the API response, not
  hardcoded — the values documented in the brief were only used to verify
  the fetched response against `policy.py`, not embedded as constants in
  the UI.
- The "Autonomous Recovery" action-permission matrix (Retry / Payment
  link / Reminder / Escalate / Suppress) reflects the actual gating logic
  in `evaluate_policy()` — which specific rule can reroute each action —
  not invented capabilities.

## What this round changed, for reference

- Header: new subtitle framing ("REVORA is operating within
  merchant-defined recovery boundaries.") and a "Control Status" pill
  (Active/Unavailable, reusing the same pulsing-dot pattern as
  `Header.tsx`'s "SYSTEM ACTIVE" indicator) sit alongside the existing
  policy-version pill and Refresh button. Same `loadPolicies()` fetch
  logic as before — no new endpoints called.
- New signature visual: `RecoveryBoundaryPanel.tsx` — a compact, static
  "bounded autonomy" diagram (AI proposes → deterministic policy gate →
  three real outcomes: Execute automatically / Escalate to merchant /
  Hold (suppress)). Explanatory, not a live/animated traffic feed.
- New `ActionPermissions.tsx` — one row per real `Action` enum value,
  each labeled Automatic-within-limits, Always-reviewed, or
  Automatic-hold based on the actual policy rules that can reroute it,
  reusing `ACTION_LABEL`/`ACTION_PREVIEW` from `frontend/lib/actionMeta.ts`
  rather than re-deriving action copy.
- New `ControlGroups.tsx` — the six real policy values regrouped into
  four business-facing sections (Action Limits, Customer Contact,
  Escalation, Risk Boundaries), each control shown as a plain-language
  sentence plus its value, with the raw config key as a small secondary
  monospace caption (not the primary label) per CLAUDE.md §6's
  progressive-disclosure pattern.
- Removed the old "Decision Control Flow" architecture-steps list and the
  old flat "Active Safety Guardrails" list — their content (ML Model →
  Decision Engine → Policy Gate → Executor, and the six policy values) is
  now represented through the boundary panel + grouped control cards
  instead, so no information from the prior version was dropped.
- Verified responsive at 1440 / 1280 / 1024 / 768 / 390px — no horizontal
  overflow, permission/control cards reflow to single column on mobile.
