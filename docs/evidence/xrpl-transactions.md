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

### run-demo 2026-09-04
- payment intent `pi_a1b05da62ccqgpd10kjmmnrp` — delivered
- x402 quote payment: `D79D3181723A9E6367D9E54A33AD5C7E1A031CA1FB2969B23B69D880E68E5E7F` — https://testnet.xrpl.org/transactions/D79D3181723A9E6367D9E54A33AD5C7E1A031CA1FB2969B23B69D880E68E5E7F
- settlement: `D002343A024C92E840A8A1D951DB37EC26EB3340F2B846218115818B805F3081` — https://testnet.xrpl.org/transactions/D002343A024C92E840A8A1D951DB37EC26EB3340F2B846218115818B805F3081

### run-demo 2026-09-04
- payment intent `pi_71843qw1hb4xt256x7kxydy5` — delivered
- x402 quote payment: `3A26B09C586A088721DEEF1599BECC62C96632456E5C4D8291E3B8E85F8A526C` — https://testnet.xrpl.org/transactions/3A26B09C586A088721DEEF1599BECC62C96632456E5C4D8291E3B8E85F8A526C
- settlement: `AE72AFFD826C0ACD835AA1596BF21BACF50ACE0865F637650972AA41179870A9` — https://testnet.xrpl.org/transactions/AE72AFFD826C0ACD835AA1596BF21BACF50ACE0865F637650972AA41179870A9

### run-demo 2026-09-04
- payment intent `pi_tz6gx6a0y8za2rjhr7mw1pte` — delivered
- x402 quote payment: `26B4600198399C36F7C5E6766F2AFB24500FEEE735ABFABE0334721773B66547` — https://testnet.xrpl.org/transactions/26B4600198399C36F7C5E6766F2AFB24500FEEE735ABFABE0334721773B66547
- settlement: `13DEE4814C9BF270A862688BF88890CE00D66941CDF0A9D87E13F4A53903656A` — https://testnet.xrpl.org/transactions/13DEE4814C9BF270A862688BF88890CE00D66941CDF0A9D87E13F4A53903656A
