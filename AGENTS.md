# AGENTS.md — Working Rules for REVORA

This governs every agent (human or AI) that touches this repository:
**Claude, Antigravity, Cursor, v0, and the ChatGPT/director role.** Read this
before writing anything. If an instruction elsewhere conflicts with this
file, this file wins.

## 1. Repository Is the Single Source of Truth

There is exactly one backend, one API layer, one decision engine, one policy
engine, and (once built) one frontend. Nothing here is a draft or a "v2" —
if you think a component needs a different implementation, **modify the
existing one**, don't create a parallel copy `decision_engine_v2.py`,
`api2/`, or a second Next.js app.

Before writing any new code:
1. Read `PROJECT_STRUCTURE.md` to see what already exists and what's still spec-only.
2. Read `README.md` §"Implementation Status" — do not assume something is
   built just because it's described in the design docs.
3. If `/backend` already contains an implementation, inspect it before adding
   to it. Do not rewrite `data_gen.py`, `model.py`, `decision_engine.py`,
   `executor.py`, or the `/api/*` contract in `main.py` without a stated reason.

## 2. No Duplication — Anywhere

- **No duplicate backend or API layer.** One FastAPI app, one set of routes.
- **No duplicate decision engine.** Expected-value scoring across candidate
  actions lives in exactly one place (`backend/decision_engine.py`).
- **No duplicate policy engine.** `evaluate_policy()` / `PolicyLimits` is the
  only authority that can block, downgrade, or reroute an action. It is
  deterministic and has no ML/LLM inputs.
- **No business logic in the UI.** The frontend never re-implements recovery
  probability, expected value, or policy rules client-side — not even for
  optimistic UI. It renders what `/api/*` returns, or a pending/loading state.
- **No duplicate LLM integration.** All reasoning/explanation/copilot text
  generation goes through one provider-abstracted client (see §9), not
  scattered direct SDK calls.

## 3. The Core Architectural Rule: AI for Intelligence, Rules for Control

This is a code boundary, not just a UX idea:

- The **decision engine** may only ever *propose* an action and an expected
  value. It never executes anything and never has authority to bypass a limit.
- The **policy engine** is the only thing allowed to downgrade, block, or
  reroute a proposed action to `escalate`/`suppress`. This relationship is
  one-way: policy can override the AI; the AI can never override policy.
- No code path may let a model's output directly trigger money movement
  without passing through the policy layer first — including any new
  intervention type added later.

## 4. No Fake Functionality

- No hardcoded "success" states — a button that says "Execute Action" calls
  the real endpoint and renders the real response, including failure.
- No decorative stats. If a number can't be computed from actual pipeline
  output (scan → analyze → recover → audit), don't display it — mark it
  `TODO` instead of inventing a plausible-looking figure.
- `Action Blocked` / `Escalated` states come from real policy engine output.
  The one sanctioned exception is `/api/demo/force-retry-block`, which
  surfaces a real record that has already exhausted a real limit, on demand,
  for live demo purposes — it queries real data, it doesn't fabricate a result.
- Documentation must never claim a feature is implemented when it isn't.
  See `README.md` §"Implementation Status" and keep it current.

## 5. Coding Standards & Naming Conventions

- **Backend (Python):** `snake_case` files/functions/variables, `PascalCase`
  classes (`RecoveryModel`, `PolicyLimits`). Enum values are lowercase
  strings matching the wire format exactly (`"payment_link"`, never `"PaymentLink"`).
- **Frontend (TypeScript/React, once built):** `PascalCase` components/files,
  `camelCase` functions/variables/hooks, `kebab-case` route segments.
- **API fields:** `snake_case` everywhere, frontend and backend — don't
  camelCase-transform at the boundary.
- Leak types (`failed_payment`, `abandoned_checkout`, `failed_subscription`,
  `overdue_invoice`) and action names (`retry`, `payment_link`, `reminder`,
  `escalate`, `suppress`) are a closed, shared vocabulary. A new value must be
  added in every place it's referenced: `decision_engine.py`
  `CANDIDATE_ACTIONS`, frontend types, and `UI_DESIGN.md` status-color mapping.

## 6. Error Handling

- Every `/api/*` route must return a typed error response (HTTP status +
  JSON body with a `detail` message) rather than an unhandled 500 — the
  existing routes already do this via `HTTPException`; keep that pattern.
- External calls (Razorpay test API, LLM provider) must have explicit
  timeout + retry-with-backoff + a defined fallback (e.g. LLM explanation
  fails → show the deterministic reasoning fields without prose, don't
  block the pipeline on a text generation failure).
- Never swallow an exception silently. Log it with enough context (leak_id,
  action, endpoint) to reproduce.

## 7. Security Requirements

- No secrets in code, commits, or logs — only in `.env` (gitignored) and the
  hosting platform's secret manager in production.
- Razorpay and LLM credentials are test-mode/sandbox only for this project;
  never wire in live/production payment credentials.
- Validate and sanitize any user-supplied policy override (e.g. Recovery
  Simulator inputs) server-side before it can influence a calculation —
  never trust client-submitted numbers as authoritative.
- CORS is currently wide-open (`allow_origins=["*"]`) for local development
  only — this must be restricted to known origins before any deployment
  beyond localhost/demo.

## 8. Testing Requirements

- **Backend:** every new pure function (decision scoring, policy evaluation,
  feature building) gets a unit test. Each `PolicyLimits` rule needs at
  least one test proving it blocks/downgrades correctly — this is the
  product's core trust claim and the highest-priority test target.
- **Frontend:** component tests for any screen that branches on API
  response shape (empty, loading, error, blocked, escalated — full list in
  the design brief). Snapshot tests alone are insufficient for branching logic.
- **Integration/E2E:** at minimum one scripted test running
  `scan → analyze → recover → audit` asserting internal consistency
  (`total_recovered <= total_at_risk`, `policy_violations == 0`).
- Changing `/api/*` response shape requires updating frontend types and
  this file's §5 vocabulary note in the same change.

## 9. Adding Dependencies & Provider Abstraction

- Don't add a dependency to solve a problem the standard library or an
  already-installed package already solves.
- The **LLM provider must be abstracted** behind a single interface (e.g.
  `backend/ai/llm_client.py` exposing `generate_explanation(...)`,
  `generate_brief(...)`) selected via `LLM_PROVIDER` in `.env`. Business
  logic (decision engine, policy engine) never imports a provider SDK
  directly — only the AI layer does.
- Don't introduce a second backend framework, a second CSS approach, or a
  second state-management library without discussion.

## 10. Git Workflow

- Small, single-purpose commits. A commit touching both `/backend` and
  `/frontend` should be rare and clearly explained (e.g. an additive API
  field + the UI consuming it).
- Never commit `.env`, a `recovery_model.joblib` retrained with a different
  seed than `data_gen.py` uses (breaks demo reproducibility), `node_modules`,
  or `__pycache__`.
- PRs/commits that change the policy engine's numeric limits must call that
  out explicitly in the message — these are the product's safety claims.

## 11. Agent Responsibilities

- **Claude** — architecture, specification, design system, code review,
  cross-checking that implementations match `AGENTS.md`/`UI_DESIGN.md`,
  writing/updating the prerequisite docs as the project evolves.
- **Antigravity** — primary implementation agent for larger vertical
  slices (e.g. a full screen wired end-to-end, a new backend module),
  working from a spec handed down by Claude/the director.
- **Cursor** — in-editor implementation and refactors on existing files,
  used for targeted changes within a file/module rather than net-new
  architecture.
- **v0** — UI component generation/prototyping only, strictly conforming to
  `UI_DESIGN.md` tokens; output gets adapted into the real component
  structure in `frontend/components/`, not used as-is if it deviates from
  the design system.
- **ChatGPT / director (you)** — product direction, prioritization, final
  say on scope and sequencing; routes work to the right agent above.

No agent unilaterally changes the policy engine's semantics, the `/api/*`
contract, or the color/type tokens in `UI_DESIGN.md` without flagging the
change to the director first.
