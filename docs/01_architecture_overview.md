# ORA — Architecture Overview

Reference for monorepo layout, core services, event flow, provider abstraction, and environments.

---

## 1. Monorepo Layout

```
ora/
├── apps/
│   ├── api/                    # Public HTTP API (idempotent writes, read endpoints)
│   ├── worker/                 # Background jobs: process provider_events → internal events → ledger
│   └── scripts/                # One-off migrations, seeds, reconciliation (CLI)
├── packages/
│   ├── ledger/                 # Ledger domain: entries, double-entry, balance derivation
│   ├── provider-events/        # Raw event persistence, dedupe, verification
│   ├── banking-adapter/        # BankingAdapter interface + FakeProvider (and real adapters)
│   ├── shared-types/           # DTOs, ids, shared types used across apps/packages
│   └── db/                     # Schema, migrations, shared DB client (if single DB)
├── docs/
├── .cursor/
├── package.json                # Workspace root (npm/yarn/pnpm workspaces)
├── turbo.json                  # Optional: turbo for build/test orchestration
└── README.md
```

**Conventions:**
- **apps/** — deployable units (API server, worker, scripts). Each has its own entrypoint and can depend on **packages/**.
- **packages/** — shared libraries. No direct dependency from one package to another unless explicit; prefer `packages/shared-types` as the common dependency.
- **packages/ledger** has no dependency on **packages/banking-adapter**; provider details stay behind the adapter. The worker (or API) orchestrates adapter calls and ledger writes.
- Config and env are per-app where needed; shared defaults live in a single place (e.g. `packages/shared-types` or a small `packages/config` if it grows).

---

## 2. Core Services / Modules

| Component | Responsibility |
|-----------|----------------|
| **api** | HTTP API: auth, idempotent write endpoints (Idempotency-Key), read endpoints for balances/history. Delegates ledger writes and provider calls to internal modules; does not hold business logic beyond validation and orchestration. |
| **worker** | Consumes persisted provider events: verify (e.g. signature, idempotency), dedupe, then publish internal events that trigger ledger entries. Handles retries, dead-letter, and correlation IDs. |
| **ledger** | Append-only double-entry model. Append entries; derive balances from entries. Exposes a narrow write API (append only) and read API (balance by account, history). No direct balance updates. |
| **provider-events** | Persist raw webhook payloads (untrusted). Dedupe by provider event id (or equivalent). Expose “verified” or “to_process” events for the worker. Optional: call provider API to verify webhook (e.g. fetch transaction by id). |
| **banking-adapter** | Interface for all provider operations (credit, debit, get status, etc.). Implementations: **FakeProvider** (in-memory or DB-backed for E2E), then real providers (e.g. ProviderA, ProviderB). API/worker call the adapter, not the provider directly. |
| **shared-types** | Ids (AccountId, LedgerEntryId, ProviderEventId), DTOs for API and events, shared enums. Single source of truth for types that cross service boundaries. |
| **db** | Schema (ledger tables, provider_events table, any app-specific tables), migrations, and a shared DB client used by api, worker, and packages that need persistence. |

**Data flow in short:**  
Provider sends webhook → **api** (or webhook receiver) persists to **provider-events** → **worker** processes events, optionally uses **banking-adapter** to verify → worker writes to **ledger**. Balances are always read from **ledger**.

---

## 3. Event Flow: Provider Webhook → Provider Events → Internal Events → Ledger

All external provider input is treated as untrusted. It is persisted first, then verified and deduped; only then does it drive ledger writes.

```
  Provider                    ORA
  ────────                    ───

  Webhook  ──────────────►  [Webhook receiver]
       (POST /webhooks/:provider)     │
                                      ▼
                            Persist raw payload
                            to provider_events
                            (id, provider, payload, received_at)
                                      │
                                      ▼
                            Worker: poll or subscribe
                            to new provider_events
                                      │
                            Verify (signature, id, etc.)
                            Dedupe (by provider event id)
                                      │
                            If duplicate → ack, skip
                            If invalid  → dead-letter / alert
                                      │
                                      ▼
                            Emit internal event
                            (e.g. ProviderTransferSettled,
                             ProviderTransferFailed)
                                      │
                                      ▼
                            Ledger: append double-entry
                            (e.g. credit user, debit float;
                             or reverse, fee, etc.)
                                      │
                                      ▼
                            Mark provider_event as processed
                            (optional: link to ledger entry ids)
```

**Principles:**
1. **Persist raw first** — Every webhook body is stored (and optionally checksummed) before any business logic. No “process then persist.”
2. **Verify and dedupe** — Before creating internal events or ledger entries, verify the event (e.g. with provider API) and enforce idempotency by provider event id (or provider + id).
3. **Internal events** — Domain-level events (e.g. `TransferSettled`, `TransferFailed`) are what the ledger layer reacts to. They carry minimal, typed payloads (ids, amounts, reason). Internal events can be in-process (function call, queue message) or a small internal bus; avoid leaking provider-specific fields into the ledger.
4. **Ledger is append-only** — Worker (or delegated service) appends entries. No updates or deletes to ledger rows. Reversals and adjustments are new entries.
5. **Idempotency** — Processing the same provider_event id twice must not create duplicate ledger entries. Use provider_event id (or a composite) in idempotency checks when appending ledger entries.

---

## 4. BankingAdapter Strategy

**Goal:** All provider-specific logic lives behind a single interface. The rest of the system talks only to the adapter; swapping or adding providers does not change ledger or API contract.

**Interface (conceptual):**
- **Initiate transfer** (e.g. `transferOut(accountId, amount, idempotencyKey)`) → returns pending transfer id or failure.
- **Get transfer status** (e.g. `getTransferStatus(transferId)`) → pending | settled | failed.
- **Webhook verification** (optional) — some providers support “fetch by id” to verify a webhook; adapter can expose `verifyWebhook(payload)` or the worker calls `getTransferStatus` after persisting the raw event.
- **Account/balance at provider** (if needed for reconciliation) — e.g. `getProviderBalance()` or `getStatement(period)` behind the same interface.

**Implementations:**
- **FakeProvider** — First implementation. In-memory or DB-backed; simulates success/failure and delay. Used for E2E tests and local dev. Must be capable of “simulate webhook” so the full flow (webhook → provider_events → internal events → ledger) can be tested without a real provider.
- **Real providers** — Each real provider is a separate adapter implementation (e.g. `ProviderAAdapter`, `ProviderBAdapter`). Config or env selects which adapter(s) are used per environment (e.g. Fake in dev, real in staging/prod).

**Adapter placement:**  
Live in **packages/banking-adapter**. The **api** and **worker** depend on the interface and a factory (or DI) that returns the right implementation for the environment. No provider-specific code in **packages/ledger** or **packages/provider-events** beyond “provider id” as an opaque key.

**Routing:**  
If multiple providers exist, routing (which provider for which transfer) is a separate concern — e.g. in the api or a small “routing” module that chooses adapter and then calls it. The ledger records the outcome, not the provider name, unless needed for ops (e.g. stored in entry metadata).

---

## 5. Environments: Dev / Staging / Prod

| Aspect | Dev | Staging | Prod |
|--------|-----|---------|------|
| **Purpose** | Local feature work, E2E with FakeProvider | Integration with real providers (or sandbox), full pipeline | Live traffic, real money movement |
| **BankingAdapter** | FakeProvider only | FakeProvider + real provider sandbox (or one real) | Real provider(s) only |
| **Webhooks** | Simulated (e.g. script or FakeProvider emits) or tunnel (e.g. ngrok) | Real provider webhooks to staging URL | Real provider webhooks to prod URL |
| **DB** | Local or shared dev DB; migrations applied | Dedicated staging DB; migrations applied | Dedicated prod DB; migrations via controlled process |
| **Secrets** | Env file or local env; no real provider keys | Real provider sandbox keys (or test keys) | Real provider production keys; secret manager |
| **Logging / Metrics** | Structured logs; optional local metrics | Full logging + metrics; no PII | Full logging + metrics; retention and alerting |
| **Idempotency** | Enforced (same as prod) | Enforced | Enforced |
| **CI** | Lint, typecheck, unit tests | + E2E with FakeProvider | + E2E; deploy after staging validation |

**Dev:**  
Run api + worker locally; use FakeProvider so no external provider is needed. Provider “webhooks” can be triggered by a script that POSTs to `/webhooks/fake` with a known payload, or by FakeProvider when a transfer is initiated.

**Staging:**  
Mirror prod as much as possible: same code paths, real (or sandbox) provider, real webhooks. Use for sign-off before prod releases and for debugging provider issues without affecting real users.

**Prod:**  
Only deploy after staging passes. All non-negotiables (ledger, idempotency, verify/dedupe, no direct balance updates) are enforced. Changes to ledger schema or event flow require migration and backward compatibility.

---

*Document owner: engineering. Update when adding services, changing event flow, or introducing new environments.*
