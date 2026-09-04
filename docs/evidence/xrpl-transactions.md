# XRPL Testnet — transaction evidence

Network: **Testnet** (`wss://s.altnet.rippletest.net:51233`, CAIP-2 `xrpl:1`).
Explorer: https://testnet.xrpl.org · SourceTag `20260530` (XRPL AI Starter Kit).

Demo wallets (Testnet, created by `pnpm xrpl:setup`):

| Role | Address |
|------|---------|
| settlement | `r4xvazJoqaua8RJPjcKB59cXdcKAQWxBia` |
| oracle (x402 FX service) | `rB7fRYCLLj7V5ctcYtx3eVT42GABVaMh7H` |
| agent (payer) | `r4ASD7mXr8pUxMGZiU8JWuvQCGuUPFCNQU` |
| merchant | `r3Tcd4wX8trtKZxSBq35Z2e2ybA7ujucDn` |

All four hold RLUSD trust lines to the Testnet issuer `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`
(TrustSet `tesSUCCESS`). On-chain value moves in **XRP** because the Testnet RLUSD faucet is
GitHub-gated at 10 RLUSD/24h (see `feedback-submissions.md` #2); the executor's RLUSD code path is
used automatically for any wallet that carries an RLUSD balance, and on Mainnet.

## Executor smoke test (agent → oracle, 0.25 XRP)

| # | Kind | Hash | Ledger | Result | Verified |
|---|------|------|--------|--------|----------|
| — | x402_payment (smoke) | `AF65C045B475B314A3CCA69A914D823A9A969C507E0C3EF65329D9676BCB53EF` | 20476504 | tesSUCCESS | ✓ re-read from a node |

The full seeded demo produces two more (the x402 quote payment and the merchant settlement) —
appended here by `scripts/run-demo.ts`.
