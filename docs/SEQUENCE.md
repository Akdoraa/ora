# Ora — end-to-end sequence

The seeded demo, from merchant integration to delivered outcome.

```mermaid
sequenceDiagram
  autonumber
  participant M as Merchant
  participant API as Ora API
  participant AG as Ora Agent
  participant POL as Policy/Guardrails
  participant RT as Routing
  participant H as Human payer
  participant BANK as DemoBankProvider
  participant OR as Ora x402 FX Oracle
  participant FAC as Ora Facilitator
  participant XE as XRPL Executor
  participant XRPL as XRPL Testnet
  participant LG as Ledger
  participant FUL as Fulfilment

  M->>API: POST /api/payment-intents (amount, currency, settlementCurrency)
  API-->>M: { id, checkoutUrl, manifestUrl }

  H->>API: POST /api/payment-intents/:id/run { objective }
  API->>AG: runAgent
  AG->>AG: parsePaymentObjective  → typed constraints (LLM or heuristic)
  AG->>RT: listQualifiedRoutes → 4 candidates persisted
  AG->>POL: effectiveConstraints(policy ∧ objective)
  AG->>RT: evaluateRoutes + selectRoute → Ora rail selected, 3 rejected (reasons)
  AG->>BANK: createAuthorization → confirmAuthorization
  BANK-->>AG: confirmed
  AG->>LG: post capture (external_world → funds_pending)
  AG->>POL: requiresApproval? → yes (£4,250 > £4,000, new payee)
  AG-->>API: awaiting_approval
  API-->>H: approval card (amount + reasons)

  H->>API: POST /api/payment-intents/:id/approve { approve }
  API->>AG: continueAgent

  AG->>OR: POST /api/x402/quote (no payment header)
  OR-->>AG: 402  PAYMENT-REQUIRED { accepts:[exact, xrpl:1, XRP, payTo, amount, invoiceId] }
  AG->>POL: guard: price ≤ max, asset ∈ allow, payTo == oracle, network == xrpl:1
  AG->>XE: presign XRPL Payment (SourceTag, InvoiceID=SHA256, memo)
  AG->>OR: POST /api/x402/quote  PAYMENT-SIGNATURE: <signedTxBlob>
  OR->>FAC: verifyAndSettle
  FAC->>FAC: 9 pre-submit checks (type, dest, amount, LLS, invoice binding, …)
  FAC->>XRPL: submitAndWait(signedTxBlob)
  XRPL-->>FAC: validated tesSUCCESS  ⟶ tx #1
  FAC->>XRPL: tx lookup (independent verify)
  OR->>OR: sign FX quote (HMAC, 5-min TTL)
  OR-->>AG: 200 { quote, signature }  PAYMENT-RESPONSE: <tx #1>

  AG->>API: settlePayment
  API->>OR: verify signed quote (signature + not expired)
  API->>LG: post fee (1%) + FX spread + merchant payable  (Σ per currency = 0)
  API->>XE: executePayment(settlement → merchant wallet)
  XE->>XE: validate amount/dest/asset/network/limits/invoice
  XE->>XRPL: autofill → local sign → submitAndWait
  XRPL-->>XE: validated tesSUCCESS  ⟶ tx #2
  XE->>XRPL: tx lookup (independent verify)
  API->>LG: post payout (discharge merchant_payable → external_world)
  API->>FUL: deliverFulfilment (only now)
  FUL-->>H: report + 50,000 API credits (one-time token)
  API->>M: webhook payment.settled / payment.delivered (HMAC signed)
  API-->>H: receipt (fee, savings vs 4% card, settlement time, both tx hashes)
```

Failure edges (each reaches a recoverable, explained state and a webhook):
bank `fail`/`expire` → `authorization_failed` / `expired`; approval `reject` →
`cancelled`; x402 not settled → stays `x402_quote_paid`, retriable; XRPL
`executePayment` throws → `settlement_failed` (retry edge); expired quote →
`QuoteExpiredError` before any settlement leg.
