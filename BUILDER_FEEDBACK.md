# Builder feedback — XRPL developer experience

Feedback pushed continuously by the challenge feedback hook during the build; a
running log is in `docs/evidence/feedback-submissions.md`. This is the wrap-up.

## What worked well

- **`xrpl.js` (v5) core payment flow.** `Client` → `autofill` → `wallet.sign` →
  `submitAndWait` is clean, and `submitAndWait` returning only on a validated
  ledger result removed all the "is it confirmed yet" ambiguity. 3–5s finality
  held throughout — settlement demos land in 5–7s end to end.
- **Testnet XRP faucet** (`faucet.altnet.rippletest.net`) — `client.fundWallet()`
  is reliable and fast; funding four wallets took seconds.
- **`TrustSet` for RLUSD** — straightforward; `tesSUCCESS` first try on all four
  wallets.
- **The `xrpl-agentic-resources` skill** — the vendored `xrpl-payments` and
  `xrpl-agent-wallet` SKILL.md files are excellent: the RLUSD testnet issuer, the
  hex currency code, the SourceTag convention, and the "never echo the seed"
  discipline are all exactly what an agent build needs, in one place.
- **`x402-xrpl` SDK** — the wire-format helpers (`encodePaymentRequiredHeader`,
  `decodePaymentSignatureHeader`, `XRPLPresignedPaymentPayer`) and the
  documented `xrpl-scheme` (9 facilitator checks, memo + `InvoiceID` binding)
  made a spec-accurate implementation feasible in a day.

## Documentation gaps / friction

1. **x402 on Testnet is undocumented.** The hosted t54 facilitator page
   (`xrpl-x402.t54.ai`) documents only a **Mainnet** endpoint
   (`https://xrpl-facilitator-mainnet.t54.ai`, `XRPL_NETWORK=xrpl:0`), and the
   `t54-labs/x402-secure` README only shows a Python + Base-Sepolia USDC
   example. For a hackathon that must stay on Testnet there is no documented
   Testnet facilitator URL and no end-to-end xrpl.js snippet for the
   402 → pay → verify/settle loop — we hand-rolled the facilitator against
   `s.altnet.rippletest.net`. The `merchant-guides/express` page does show
   `XRPL_FACILITATOR_URL=http://127.0.0.1:8011` (self-host), but nothing tells
   you how to run that on Testnet.

2. **RLUSD Testnet faucet is impractical.** `tryrlusd.com` — the faucet the t54
   `rlusd-skills` docs point to for "RLUSD testnet tokens" — is gated behind
   GitHub OAuth and dispenses **10 RLUSD / 24h / account** with no HTTP API. It
   is impossible to script, and impossible to demo any realistic-value RLUSD
   settlement on Testnet. Agentic RLUSD demos effectively have to fall back to
   XRP. A rate-limited *programmatic* Testnet RLUSD faucet (even
   ~1,000 RLUSD/day/address) would remove a hard blocker.

3. **`x402-xrpl` pins `xrpl@4`.** The SDK depends on `xrpl@4.6.0` while the
   current release is `5.1.0`; passing a v5 `Client` into
   `XRPLPresignedPaymentPayer` fails typecheck on a nominal private-property
   mismatch. Workaround: let the payer open its own connection. A peer-dep range
   or a v5 bump would help.

4. **`tx` response shape moved.** Newer `rippled` nests the transaction under
   `result.tx_json`; older responses are flat. Verifiers that read
   `result.Account` / `result.Memos` silently get `undefined`. Worth a note in
   the `tx` method docs.

5. **`NetworkID` on sub-1024 networks.** It's not obvious from the docs that
   Testnet (network id 1) transactions typically omit `NetworkID` — an x402
   facilitator check that requires it will reject valid Testnet payments.

## Faucet / Testnet issues

- XRP faucet: reliable.
- RLUSD faucet: see #2.
- Explorer (`testnet.xrpl.org`): fine; transactions appeared within a few
  seconds of `submitAndWait` returning.

## Mainnet-readiness observations

- The same code path settles on Mainnet with a one-line `XRPL_NETWORK` change and
  a funded RLUSD wallet — the executor already builds `IssuedCurrencyAmount`
  payments and is trust-line aware.
- Reserves/fees are read live (never hardcoded), so a fee-vote or reserve change
  won't break settlement math.
- The gap to a real product is the **bank rail** (a licensed open-banking /
  FAST / PayNow partner) and compliance (KYC/KYB, sanctions) — see
  `docs/BANK_BOUNDARY.md`. XRPL + RLUSD themselves felt production-ready for the
  settlement and agentic-payment legs.
