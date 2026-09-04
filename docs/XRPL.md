# Ora — XRPL integration

## Network

XRPL **Testnet** — `wss://s.altnet.rippletest.net:51233` (CAIP-2 `xrpl:1`).
Explorer: <https://testnet.xrpl.org>. `SourceTag 20260530` (XRPL AI Starter Kit)
tags every Ora transaction so agentic volume is attributable on-chain.
Network + testnet labels appear on the checkout, receipt, dashboard, and every
place a hash is shown. Live reserves/fees are read from the
`xrpl-agentic-resources` skill snapshots, never hardcoded.

## Wallets (`pnpm xrpl:setup`)

Four server-held Testnet wallets — `settlement`, `oracle` (x402 FX service),
`agent` (payer), `merchant`. Faucet-funded (~100 XRP each) and given RLUSD trust
lines to the Testnet issuer (`TrustSet` → `tesSUCCESS`). Seeds are written to
`.env.local` (gitignored) and loaded **server-side only** via `src/lib/xrpl/wallets.ts`
— never in a client bundle, never logged (pino redaction), never passed to the LLM.

## The executor (`src/lib/xrpl/executor.ts`)

The only place a transaction is signed. For every payment it:

1. **validates** deterministically — destination is a classic `r…` address,
   amount > 0 and ≤ the guard max, asset ∈ the allowlist, destination ∈ the
   allowlist (when set), `invoiceId` present;
2. inserts an `xrpl_transactions` row (`status: created`);
3. builds the `Payment` with `SourceTag`, `InvoiceID = SHA256(invoiceId)`, and a
   memo; `client.autofill` (Fee, Sequence, LastLedgerSequence from the node);
4. **signs locally** (`wallet.sign`), persists the hash *before* submitting
   (`status: submitted`) so a crash is reconcilable, not resubmitted;
5. `client.submitAndWait` — waits for a validated ledger result; retries once on
   a transient `ter*`;
6. reads `meta.TransactionResult`; success requires `validated == true` and
   `tesSUCCESS`. Otherwise `SettlementError` and `status: failed` with the
   engine result.

## Independent verification (`src/lib/xrpl/verify.ts`)

`verifyTransactionByHash` re-reads the transaction with a `tx` request (handling
the `tx_json` nesting of newer `rippled`), decodes memos, and confirms
`validated` + `tesSUCCESS`. `GET /api/xrpl/transactions/:hash` exposes this; the
agent calls it as its `verifyXRPLTransaction` step and the settlement service
calls it after the payout.

## Two genuine Testnet transactions per run

1. **x402 payment** — `agent` wallet → `oracle` wallet, for the signed FX quote.
2. **Settlement** — `settlement` wallet → `merchant` wallet.

Both hashes are stored on `xrpl_transactions`, shown on the receipt +
payment-detail + settlements pages with explorer links, and appended to
`docs/evidence/xrpl-transactions.md` by `pnpm demo:run`.

## Testnet vs Mainnet

On-chain value moves in **XRP** on Testnet because the RLUSD Testnet faucet
(`tryrlusd.com`) is GitHub-OAuth-gated and capped at 10 RLUSD / 24h with no API
(`docs/evidence/feedback-submissions.md` #2). The executor's RLUSD path
(`IssuedCurrencyAmount`, trust-line aware) is exercised automatically for any
RLUSD-funded wallet and is the Mainnet path. Switching network is a one-line env
change (`XRPL_NETWORK`, `XRPL_WSS_URL`).
