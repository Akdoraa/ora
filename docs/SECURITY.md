# Ora — security & production readiness

## Implemented in this build

| Control | Where |
|---|---|
| Server-only wallet secrets; no private key in any client bundle | `src/lib/xrpl/wallets.ts` (seeds from env only); `serverExternalPackages`; no `NEXT_PUBLIC_` secret |
| Env validation at boot | `src/env.ts` (Zod), server-secret guard, `.env.example` |
| No secrets committed | `.gitignore` (`.env*` except `.env.example`), seeds appended to `.env.local` |
| Policy-gated signing | LLM never signs; `hardSpendGuard` + `requiresApproval` re-checked in code; executor re-validates amount/dest/asset/network/invoice before `wallet.sign` |
| Spend limits & allowlists | `AgentPolicy` (max payment, daily spend, approved currencies/merchants/providers); executor `guard.allowedAssets` / `allowedDestinations` |
| New-payee approval | `AgentPolicy.requireApprovalForNewPayee` → `ApprovalRequest` |
| Idempotency | `Idempotency-Key` → `idempotency_keys` (stores response, rejects body mismatch); ledger `postTransaction` dedupes on key; webhook delivery `onConflictDoNothing` |
| Signed webhooks | `Ora-Signature: t=<unix>,v1=<hmac-sha256(t.body)>`; `verifyWebhook` enforces a 5-min timestamp tolerance + constant-time compare |
| Webhook retries / replay | exponential backoff (`webhook_deliveries`), `replayDelivery` |
| Audit log | append-only `audit_events` for every state transition, agent step, x402, settlement, refund |
| Transaction verification | independent `tx` re-read; `validated` + `tesSUCCESS` required before fulfilment |
| Input validation | Zod on every API body; predictable `{ error, message, detail }` shape |
| Error sanitisation | API errors are typed strings, not stack traces; pino `redact` for seed/token/secret/authorization/password/apiKey |
| No sensitive data in logs | structured pino; amounts + ids only; no PAN, no credentials |
| Secure signing discipline | local `wallet.sign` only, never a remote sign API; hash persisted before submit |
| Network / testnet labels | on checkout, receipt, dashboard, every hash |
| Failure recovery | every failure path → a defined recoverable state + webhook (see `SEQUENCE.md`) |
| Reconciliation | `trialBalance` (Σ per currency = 0) surfaced on `/dashboard/settlements` |

## Documented for production (not implemented in the prototype)

- **Rate limiting** — per-API-key + per-IP token bucket at the edge; stricter on
  write endpoints; `429` + `Retry-After`. (Interface point: a middleware in
  front of `src/app/api/*`.)
- **CSRF / cookies** — the dashboard is demo-scoped and has no mutating
  cookie-auth surface today; a production dashboard uses Auth.js with
  `SameSite=Lax`, `Secure`, `HttpOnly` session cookies and CSRF tokens on
  form posts.
- **Field encryption** — envelope encryption (per-record data key wrapped by a
  KMS master key) for PII and partner tokens; the prototype stores none.
- **KYC/KYB & sanctions screening** — a `ComplianceProvider` boundary invoked
  before onboarding a merchant and before a first payout to a new payee; blocks
  are surfaced as a payment-intent failure state.
- **Data retention** — audit + ledger retained ≥ 1 year (immutable); provider
  events retained per partner contract; PII minimised and deletable on request.
- **Custody boundary** — see `docs/BANK_BOUNDARY.md`.
- **Monitoring** — health checks, reconciliation-drift alert, webhook
  dead-letter alert, XRPL submit-error rate, model-fallback rate.

## Threat notes

- Provider webhooks/callbacks are untrusted — verified + deduped before any
  ledger write.
- XRPL memos on *incoming* transactions are never interpreted as instructions
  (prompt-injection guard; the agent only acts on the human's objective).
- The x402 facilitator binds every payment to an `invoiceId` (memo + `InvoiceID`)
  to prevent replay.
