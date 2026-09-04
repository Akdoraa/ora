# ORA — Build Plan Epics

Epics in dependency order. Each epic has acceptance criteria that must be met before the epic is considered done. Implement in this order unless explicitly decoupled.

---

## Epic 1: Repo / CI

**Goal:** Monorepo structure, workspace tooling, and CI that enforces lint, typecheck, and tests on every change.

**Dependencies:** None.

**Acceptance criteria:**

- [ ] Monorepo layout exists per `docs/01_architecture_overview.md`: `apps/` (api, worker, scripts), `packages/` (ledger, provider-events, banking-adapter, shared-types, db), workspace root `package.json`.
- [ ] All apps and packages build (e.g. `npm run build` or equivalent from root and per package).
- [ ] Lint runs across the repo and passes (e.g. ESLint/BIOME; no lint errors on committed code).
- [ ] Typecheck runs across the repo and passes (e.g. TypeScript strict; no type errors).
- [ ] Unit tests run from root (e.g. `npm run test`); at least one test exists per package that will contain logic.
- [ ] CI pipeline runs on push/PR: lint, typecheck, tests. Pipeline is documented (e.g. in README or `.github/workflows`).
- [ ] README at repo root describes how to install deps, build, test, and run apps locally.

---

## Epic 2: DB

**Goal:** Database schema, migrations, and shared DB client for ledger, provider events, and core entities. No application logic in this epic beyond schema and access.

**Dependencies:** Epic 1 (Repo/CI).

**Acceptance criteria:**

- [ ] `packages/db` (or equivalent) contains schema for: **users**, **ledger_accounts**, **ledger_transactions**, **ledger_entries**, and **provider_events** (per domain model). Schema supports append-only ledger (no updates/deletes on entries/transactions).
- [ ] Migrations are versioned and runnable up/down (or forward-only with documented policy). Seed script exists to create minimal data (e.g. system accounts) for local dev.
- [ ] Unique constraint (or equivalent) on `(provider, provider_event_id_external)` for provider_events to enforce dedupe.
- [ ] Shared DB client is used by packages that need persistence; connection/config is via env (no hardcoded credentials). README or env example documents required DB env vars.
- [ ] CI runs migrations (or migration check) so schema changes are validated.

---

## Epic 3: Ledger

**Goal:** Append-only double-entry ledger: append transaction + entries, derive balance from entries only. No direct balance updates.

**Dependencies:** Epic 2 (DB).

**Acceptance criteria:**

- [ ] `packages/ledger` exposes: (1) append transaction with N entries (single atomic write), (2) get balance for account_id (SUM of entries), (3) get history/entries for account (and optionally for transaction). All writes are append-only; no update/delete of ledger rows.
- [ ] Every appended transaction is balanced: sum of entry amounts = 0. Append fails (transaction rolled back) if not balanced.
- [ ] Ledger package does not depend on `packages/banking-adapter` or provider-specific code. It depends only on shared-types and db (or repository abstraction).
- [ ] Idempotency: append can accept an idempotency key; duplicate key returns existing transaction/result and does not insert again.
- [ ] Unit tests for: balanced transaction accepted, unbalanced rejected, balance derivation correct after multiple appends, idempotency same key returns same result. Property/invariant tests where feasible (e.g. sum of all entry amounts across accounts = 0 for a transaction).
- [ ] Structured logging and correlation ID support in ledger operations (or delegated to caller); no PII in logs.

---

## Epic 4: Provider abstraction

**Goal:** BankingAdapter interface and FakeProvider implementation. All provider operations go through the adapter; no direct provider calls elsewhere.

**Dependencies:** Epic 1 (Repo/CI). Can run in parallel with Epic 2/3 if no DB is needed for FakeProvider; otherwise Epic 2.

**Acceptance criteria:**

- [ ] `packages/banking-adapter` defines a **BankingAdapter** interface with at least: initiate transfer out (e.g. `transferOut` with account, amount, idempotency key), get transfer status (e.g. `getTransferStatus(transferId)`). Interface is documented (e.g. when it returns pending/settled/failed).
- [ ] **FakeProvider** implements BankingAdapter: in-memory or DB-backed; can simulate success, failure, and optional delay. It can “emit” a webhook-equivalent (e.g. callback or stored payload) so the full webhook → ledger flow can be tested without a real provider.
- [ ] API and worker (when added) depend on the adapter interface and a factory/config that returns the implementation (FakeProvider in dev/test). No provider-specific imports outside `packages/banking-adapter`.
- [ ] E2E or integration test: call adapter to initiate transfer, simulate webhook/callback, verify outcome without a real provider. Document how to run FakeProvider and trigger “webhooks” locally.

---

## Epic 5: Pricing / Quotes

**Goal:** Quote entity: create quote (from/to currency, amount, rate or derived amount), enforce expiry; support one-time use by Conversion.

**Dependencies:** Epic 2 (DB), Epic 3 (Ledger). Ledger needed if quote creation reserves or touches ledger; otherwise DB + shared-types only.

**Acceptance criteria:**

- [ ] Schema and domain for **Quote**: quote_id, from_currency, to_currency, from_amount/to_amount (or rate), expires_at, created_at. Optional: user_id, fee breakdown.
- [ ] API (or internal API): create quote returns quote_id and expires_at. Quote is immutable once created.
- [ ] Quote expiry enforced: any use of a quote (e.g. by Conversion) checks `now < expires_at` at execution time; if expired, operation is rejected and no ledger write occurs.
- [ ] One-time use: when a Conversion is tied to a quote, the quote is marked used (or Conversion stores quote_id and logic prevents double use). Duplicate conversion with same quote_id is rejected or idempotent.
- [ ] Unit tests: quote creation, expiry check (valid vs expired), one-time use semantics. No PII in logs.

---

## Epic 6: Conversions

**Goal:** Execute a conversion (e.g. currency A → B): debit one account, credit another, optional fee; optionally consume a Quote. Idempotent; creates one LedgerTransaction.

**Dependencies:** Epic 3 (Ledger), Epic 5 (Pricing/Quotes).

**Acceptance criteria:**

- [ ] Conversion flow: validate quote (if present) not expired and not already used; validate from_account has sufficient balance (from ledger); create one LedgerTransaction with balanced entries (e.g. debit from_account, credit to_account, optional debit fee to fee account); record Conversion row with status completed and ledger_transaction_id.
- [ ] All conversion write paths require Idempotency-Key. Same key returns same Conversion and does not create a second LedgerTransaction.
- [ ] If quote expired or insufficient balance, conversion is rejected; no ledger entries written.
- [ ] API: endpoint to execute conversion (from_account_id, to_account_id, amount, quote_id optional, Idempotency-Key required). Response includes conversion_id, status, ledger_transaction_id. Read endpoint: get conversion by id.
- [ ] Unit tests: successful conversion creates balanced transaction; idempotency; expired quote rejected; insufficient balance rejected. Balances derived from ledger match expected after conversion.

---

## Epic 7: Webhooks

**Goal:** Receive provider webhooks, persist raw to provider_events, worker verifies/dedupes and writes to ledger. No trust of webhook payload until verified.

**Dependencies:** Epic 2 (DB), Epic 3 (Ledger), Epic 4 (Provider abstraction).

**Acceptance criteria:**

- [ ] Webhook receiver (in API or dedicated app): POST to `/webhooks/:provider` persists raw body to provider_events (provider, provider_event_id_external from payload or generated, payload, received_at). Returns 2xx quickly (e.g. 200) so provider does not retry unnecessarily; processing is async.
- [ ] Unique constraint on (provider, provider_event_id_external) prevents duplicate rows; duplicate webhook returns 200 and stores at most one row (or dedupe on insert).
- [ ] Worker: polls or subscribes to unprocessed provider_events; for each event, verifies (e.g. signature or adapter.verify/getTransferStatus); dedupes by (provider, provider_event_id_external)—process at most once; on success, creates internal event and appends LedgerTransaction/entries (e.g. credit user, debit float); marks event processed. On invalid: mark rejected or dead_letter; do not write ledger.
- [ ] FakeProvider can simulate webhook payload; E2E test: trigger “webhook”, worker processes, ledger updated once; duplicate webhook does not double ledger entries.
- [ ] Correlation ID propagated from webhook request through worker to ledger/audit. Structured logging; no PII or full payload in logs.

---

## Epic 8: Spend handling

**Goal:** User-initiated outbound movement (Spend): debit user account via ledger, optional integration with adapter for external transfer. Idempotent.

**Dependencies:** Epic 3 (Ledger), Epic 4 (Provider abstraction). Optionally Epic 7 (Webhooks) if spend settlement is confirmed via webhook.

**Acceptance criteria:**

- [ ] Spend flow: validate account ownership and sufficient balance (from ledger); create LedgerTransaction (debit user account, credit float or provider-out); create Spend row (spend_id, account_id, amount, status pending/completed, ledger_transaction_id, idempotency_key). Optionally call BankingAdapter to initiate external transfer; link provider transfer id to Spend.
- [ ] All spend write paths require Idempotency-Key. Same key returns same Spend and does not create a second debit or second LedgerTransaction.
- [ ] API: endpoint to create spend (account_id, amount, destination, Idempotency-Key required). Response includes spend_id, status, ledger_transaction_id. Read: get spend by id. Optional: webhook from provider updates Spend status and optionally creates ledger entry for settlement (then Epic 7 integration).
- [ ] Unit tests: spend creates one balanced transaction; idempotency; insufficient balance rejected. No double debit for same idempotency key.

---

## Epic 9: Admin

**Goal:** Admin-only tooling: reconciliation, read-only views, and operational support without direct balance manipulation.

**Dependencies:** Epic 3 (Ledger), Epic 7 (Webhooks) recommended so provider_events exist. Epic 6 and 8 for full picture.

**Acceptance criteria:**

- [ ] Reconciliation script or endpoint (admin-only): compare sum of ledger balances (by account type) to expected invariant (e.g. user total + float + fees = X). Report drift and list discrepancies. Document how to run and interpret.
- [ ] Read-only admin views or scripts: list recent ledger_transactions/entries, provider_events with status, optional Spend/Conversion summary. No write/update/delete of ledger or provider_events from admin UI; corrections go through ledger append (reversal/adjustment) with proper controls.
- [ ] Audit: admin actions (who ran reconciliation, who accessed bulk data) are logged (per `docs/02_security_and_compliance_baseline.md`). No PII in logs; use stable ids.
- [ ] Documented runbook or README for common admin tasks (reconciliation, inspect event, trace a transfer).

---

## Epic 10: Hardening

**Goal:** Production-ready controls: rate limits, audit logs, monitoring, and incident response basics.

**Dependencies:** All prior epics. API and worker are in place; ledger and provider flows work.

**Acceptance criteria:**

- [ ] **Rate limits:** API write endpoints (conversion, spend, etc.) are rate-limited per client/user; 429 with Retry-After when exceeded. Webhook receiver has rate limit per provider. Limits are documented (e.g. in `docs/02_security_and_compliance_baseline.md` or API docs).
- [ ] **Audit logs:** Every ledger append (transaction_id, account ids, amounts, reason, idempotency key, timestamp, actor/service) is written to an audit sink (table or stream). Audit log is append-only and not used for application logging. Access to audit data is restricted.
- [ ] **Logging:** Application logs are PII-free (no secrets, no full payment details, no user identifiers beyond internal id). Correlation ID on all requests; structured format (e.g. JSON). Per `docs/02_security_and_compliance_baseline.md`.
- [ ] **Monitoring:** Health check endpoint for API and worker; metrics for request count, latency, ledger append count, worker processing rate. Alerts configured for: health down, repeated transfer/webhook failures, reconciliation drift (when reconciliation runs). Runbooks for each alert (what to check, who to involve).
- [ ] **Incident response:** Document severity levels (Critical/High/Medium/Low), response steps (detect, triage, contain, resolve, post-incident), and ownership (on-call, escalation). Preserve logs/audit for security or funds-related incidents.

---

## Order summary

| Order | Epic                | Depends on      |
|-------|---------------------|-----------------|
| 1     | Repo/CI             | —               |
| 2     | DB                  | 1               |
| 3     | Ledger              | 2               |
| 4     | Provider abstraction| 1 (and 2 if FakeProvider uses DB) |
| 5     | Pricing/Quotes      | 2, 3            |
| 6     | Conversions         | 3, 5            |
| 7     | Webhooks            | 2, 3, 4         |
| 8     | Spend handling      | 3, 4 (7 optional) |
| 9     | Admin               | 3, 7 (6, 8 recommended) |
| 10    | Hardening           | 1–9             |

---

*Document owner: engineering. Update when adding epics or changing acceptance criteria.*
