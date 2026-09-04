# Ora — bank rail & regulatory boundary

## What Ora is / is not

Ora **is** a checkout and payment-orchestration platform: hosted checkout,
payment links, QR, the Payment Intent API, agent-readable manifests, agent
policies, routing, an immutable double-entry ledger, reconciliation, webhooks,
receipts, refunds, and savings analytics.

Ora **is not** a bank, payment institution, custodian, e-money issuer, or money
transmitter, and this prototype does not claim to be one. Regulated activities —
licensed bank access, custody, fiat in/out, KYC/KYB, sanctions screening — are
the responsibility of **licensed partners** in production.

## The provider seam

`src/lib/bank-rails/provider.ts` — `BankRailProvider`:

```ts
listBanks(country) · createAuthorization(input) · getAuthorization(id)
confirmAuthorization(id, simulate?) · cancelAuthorization(id)
```

- **This build:** `DemoBankProvider` (`demo-provider.ts`). It persists a
  `bank_authorizations` row, returns a masked account reference + QR payload,
  and simulates the bank callback — `confirm` (happy path), `fail` (declined),
  `expire` (window elapsed). It never stores credentials, real or fake.
- **Production adapters (documented, not built):** one implementation of the
  same interface per partner —
  - UK/EU open banking (PIS) — Payment Initiation via an AISP/PISP licence
    holder; the payer authenticates in their own banking app, Ora never sees
    credentials.
  - Singapore **FAST / PayNow** — via a licensed local payment institution for
    the SGD payout leg.
  - Real-time account-to-account rails in the 70+ markets that now have them.
  Config/env selects the adapter per environment; the ledger and Payment Intent
  API contracts do not change.

## Production model

| Ora owns | Licensed partners own | XRPL / RLUSD |
|---|---|---|
| Checkout, payment links, QR, Payment Intent API, manifests | Regulated bank access & rails | Agentic (x402) payments |
| Routing, agent policies, approvals | Custody where required | Cross-border settlement + liquidity |
| Double-entry ledger, reconciliation, webhooks, reporting | Fiat movement, KYC/KYB, sanctions | RLUSD as the settlement asset (Mainnet) |
| Merchant + developer experience | | |

## Data handling

- No raw bank credentials are ever stored (`bank_authorizations` holds only a
  masked reference + provider reference).
- Sensitive fields: an encryption strategy is documented in `docs/SECURITY.md`
  (envelope encryption / KMS for PII and any partner tokens); the prototype
  keeps only non-sensitive demo data.
- Provider webhooks/callbacks are treated as **untrusted input** — verified,
  deduped, and persisted before they drive any ledger write.
