# Ora — API reference

Base URL: `${APP_URL}` (default `http://localhost:3000`). JSON in/out. Errors:
`{ "error": "<slug>", "message": "<human>", "detail"?: <any> }`.

Merchant endpoints authenticate with `Authorization: Bearer <api key>`
(SHA-256-hashed at rest; demo key in `/dashboard/developers`). External POSTs
accept an `Idempotency-Key` header.

## Payment intents

### `POST /api/payment-intents` — auth

```jsonc
{ "amount": 100000, "currency": "GBP", "settlementCurrency": "SGD",
  "description": "Annual software plan", "reference": "INV-2091",
  "productId"?: "...", "customerId"?: "...", "agentPolicyId"?: "...",
  "origin"?: "human"|"agent", "method"?: "bank"|"qr"|"agent",
  "successUrl"?, "cancelUrl"?, "webhookUrl"?, "metadata"?, "expiresInSeconds"? }
```
→ `201 { id, status, amount, currency, settlementCurrency, checkoutUrl,
manifestUrl, statusUrl, createdAt, expiresAt }`

### `GET /api/payment-intents/:id`
→ `200` full aggregate: `{ intent, merchant, product, routes[],
bankAuthorizations[], agentRun, agentDecisions[], approvals[], x402,
xrplTransactions[], settlement, fulfilment, audit[], isTerminal }`

### `GET /api/payment-intents/:id/status`
→ `200 { id, status, terminal, origin, amount, settlementAmount,
processingFeeAmount, savingsVsCardAmount, settlementSeconds, failureReason,
agentRun, xrplTransactions[] }`

### `GET /api/payment-intents/:id/manifest` — no auth
Agent-readable offer: merchant, offer, amount (value + minor units + currency),
settlement (currency + `xrpl:1`), pricing (fee bps, card baseline), `rails`, and
an `actions` block (run / approve / status / x402Quote with the scheme).

### `POST /api/payment-intents/:id/run`
```jsonc
{ "objective": "Pay invoice … must receive SGD …",
  "policyId"?: "...", "bankSimulation"?: "confirm"|"fail"|"expire" }
```
Runs the agent up to the approval gate. →
`{ status: "awaiting_approval", approvalId, reasons[] }` or
`{ status: "completed", txHash, x402Hash, settlementSeconds }` or
`422 { status: "failed", error, failedStep }`.

### `POST /api/payment-intents/:id/approve`
```jsonc
{ "decision": "approve"|"reject", "approvalId"?: "...", "decidedBy"?: "payer" }
```
On `approve`: resumes the run through x402 → settlement → fulfilment.

### `POST /api/payment-intents/:id/refund` — auth (or same-origin dashboard)
```jsonc
{ "reason"?: "..." }
```
→ `200 { refundId, status, amount, xrplTxHash?, explorerUrl? }`

## x402

### `POST /api/x402/quote`
```jsonc
{ "paymentIntentId", "amountInMinor", "amountInCurrency", "amountOutCurrency",
  "midRate", "fxSpreadBps", "processingFeeBps" }
```
No `PAYMENT-SIGNATURE` → `402` + `PAYMENT-REQUIRED` header (base64
`{ x402Version, resource, accepts:[…] }`).
With `PAYMENT-SIGNATURE: <base64 { x402Version, accepted, payload:{ signedTxBlob } }>`
→ `200 { quote, signature, alg }` + `PAYMENT-RESPONSE` + `x-ora-x402-checks`.

## XRPL

### `GET /api/xrpl/transactions/:hash` — no auth
→ `200 { found, hash, validated, success, engineResult, ledgerIndex, account,
destination, deliveredAsset, deliveredValue, feeDrops, memos[], invoiceId,
explorerUrl }` (or `404 { found: false }`).

## Fulfilment & webhooks

- `POST /api/fulfilment/:paymentIntentId` — trigger fulfilment (idempotent;
  requires `paid`).
- `GET /api/fulfilment/:paymentIntentId?token=<one-time>` — retrieve the
  deliverable.
- `POST /api/webhooks/test` — demo sink; verifies `Ora-Signature` and records
  the event.

## Other

- `POST /api/payment-links` — dashboard-only, demo-merchant scoped.
