# Ora — Ripple rubric coverage

Evidence mapped to each criterion. Paths are in this repo; hashes in
`docs/evidence/xrpl-transactions.md`.

## Reachability (20%)

| Expectation | Evidence |
|---|---|
| Generic hosted checkout | `/checkout/[id]` — any merchant, any payment intent |
| Merchant-independent API | `POST /api/payment-intents` + `GET :id` + `:id/status` + `:id/manifest`, API-key auth, idempotency (`src/app/api/payment-intents/`) |
| Humans **and** agents on the same infrastructure | Same Payment Intent + state machine + settlement; humans use the checkout card, agents read `/manifest` and drive `/run` + `/approve` |
| No crypto knowledge required for customers | Checkout says "Pay by bank / No card number / No card expiry / No CVC"; XRPL only under "Settlement details", the dashboard, and the audit trail |
| Multi-currency architecture | `Money` (bigint + ISO), `CURRENCY_EXPONENT`, FX via `convert`/`applyBps`; demo is GBP→SGD, routes + policy are currency-generic |
| Provider adapters | `BankRailProvider` interface + `DemoBankProvider`; `docs/BANK_BOUNDARY.md` documents licensed-partner adapters |
| Scalable merchant onboarding | merchant + API key + product + webhook rows; `POST /api/payment-links` |
| Compliance boundaries | `docs/BANK_BOUNDARY.md`, `docs/SECURITY.md` (KYC/KYB + sanctions boundary) |
| Developer accessibility | `/dashboard/developers` — masked key, TS + curl snippets, x402 example, manifest, live webhook log; `docs/API.md` |
| Plausible verticals | B2B invoices (demo), SaaS renewals, marketplace payouts, logistics, professional services, autonomous procurement agents |

## Creativity (20%)

| Expectation | Evidence |
|---|---|
| One checkout for humans and autonomous agents | above |
| Natural-language payment objectives | `parsePaymentObjective` → typed `ParsedConstraints` (`src/lib/agent/parse-objective.ts`) |
| Autonomous route discovery | `listQualifiedRoutes` → 4 seeded routes with quotes |
| Paid service discovery via x402 | `handleX402Payment` hits a real `402` and pays for the signed FX quote |
| Policy-constrained purchasing | `effectiveConstraints` (objective only tightens) + `requiresApproval` + `hardSpendGuard` |
| XRPL settlement behind bank-native UX | receipt shows fiat + savings; XRPL is progressive disclosure |
| Agent completes the purchase, not just advice | run ends in `delivered` with the report + API credits unlocked |

## Feasibility (20%)

| Expectation | Evidence |
|---|---|
| Licensed-partner architecture | `docs/BANK_BOUNDARY.md` production model table |
| Explicit state machine | `src/lib/payment-intents/state-machine.ts` + tests; illegal transitions throw |
| Bank-provider abstraction | `BankRailProvider` |
| Double-entry ledger | `src/lib/ledger/ledger.ts` — Σ per currency = 0 asserted; `trialBalance` on `/dashboard/settlements` |
| Idempotency | `Idempotency-Key` + `idempotency_keys` + ledger key dedup |
| Signed webhooks | `Ora-Signature` HMAC + tolerance + retries + replay |
| Error handling | typed API errors, `failedStep`, recoverable states |
| Reconciliation | `/dashboard/settlements` trial balance + per-payment view |
| Security controls | `docs/SECURITY.md` |
| Transparent sandbox/testnet boundaries | README "live vs sandbox vs testnet vs planned" + testnet badges |
| Credible 1% model | README "How 4% → 1%"; fee + FX spread are explicit ledger entries, never hidden spread |

## Technical depth (20%)

| Expectation | Evidence |
|---|---|
| Real structured-output AI agent | Vercel AI SDK `generateObject` with a Zod schema (`AGENT_MODE=live`) |
| Multiple agent tools | 14, each an `agent_decisions` row — `docs/AGENT.md` |
| Deterministic guardrails | policy engine + executor validation; LLM cannot override |
| Policy-gated execution | `hardSpendGuard`, `requiresApproval`, executor re-validation |
| Real x402 payment | genuine `402` → presigned XRPL Testnet Payment → verified `tesSUCCESS` |
| Real XRPL transactions | 2 per run; `docs/evidence/xrpl-transactions.md` |
| Transaction verification | `verifyTransactionByHash` (independent `tx` re-read) before fulfilment |
| Actual transaction hashes | stored on `xrpl_transactions`, shown in UI + `GET /api/xrpl/transactions/:hash` |
| Audit trail | append-only `audit_events` |
| Tests | Vitest (money, state machine, ledger incl. full lifecycle + refund, routing, policy, webhook sig, x402 challenge, idempotency) + one Playwright E2E |
| Secure wallet separation | server-only seeds, local signing, pino redaction |
| Failure recovery | every failure → defined state + webhook |

## User experience & design (10%)

| Expectation | Evidence |
|---|---|
| Polished two-step bank checkout | `/checkout/[id]` — one card, method → authorize; Figma "Payment Checkout Design" structure, Ora identity |
| Responsive | 390px → desktop grid; scroll-contained tables/diagrams |
| Clear agent activity | `AgentDecisionPanel` — routes, reasons, decision trace, settlement details |
| Plain-language payment states | `StatusLine` / `StatusPill` copy for every status |
| Transparent fees | fee + savings-vs-4%-card on checkout, receipt, dashboard |
| Progressive disclosure | XRPL behind "Settlement details" |
| Accessible | semantic elements, focus-visible rings, `prefers-reduced-motion`, keyboard-operable |
| No crypto friction | no wallet, no seed phrase, no chain prompts for the payer |
| No dead controls | every button posts to a working endpoint |
| Complete success + failure journeys | happy path + `bankSimulation=fail|expire`, approval reject, refund |

## Builder feedback (10%)

| Expectation | Evidence |
|---|---|
| Feedback hook installed correctly | project-scoped `Stop` hook in `.claude/settings.json` |
| Hook running continuously | kept on for the whole build; `docs/evidence/feedback-hook.md` |
| Verified submission | short-text rejected, injection exit 2, loop-guard exit 0, real submission `201` |
| Final feedback form | to be submitted near the end (link in `hook`/challenge README) |
| `BUILDER_FEEDBACK.md` | present — what worked, doc gaps, SDK friction, faucet/testnet issues, x402 experience, mainnet readiness |
