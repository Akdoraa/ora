# Ora — known limitations & production roadmap

## Known limitations (prototype)

| Area | Now | Why |
|---|---|---|
| On-chain asset (Testnet) | Settles in **XRP** | RLUSD Testnet faucet is GitHub-gated at 10/24h with no API (`docs/evidence/feedback-submissions.md`). The RLUSD code path runs on Mainnet / any RLUSD-funded wallet. |
| Settlement amount on-chain | A documented demo factor maps the SGD net onto a faucet-fundable XRP size | Keeps the Testnet wallets solvent across many demo runs. Fiat figures shown to the user are the real amounts. |
| Bank rail | `DemoBankProvider` (sandbox) | A real rail needs a licensed open-banking / FAST / PayNow partner — `docs/BANK_BOUNDARY.md`. |
| Auth | Dashboard demo-scoped to one merchant; API-key auth on the merchant API | Auth.js session + org model is a known drop-in (`currentMerchantId()` is the seam). |
| Route catalogue | 4 seeded routes; the Ora rail is real, the 3 competitors are labelled **demo quotations** | A live provider marketplace + real competitor pricing feeds is the production version. |
| x402 facilitator | Ora's own, in-process | The hosted t54 facilitator is Mainnet-only today; swap in when a Testnet one exists. |
| Rate limiting, CSRF, field encryption, KYC/KYB, sanctions | Documented, not implemented | `docs/SECURITY.md` names each interface point. |
| Deployment | Local; `vercel.json` + Neon path prepared | Needs the operator's Vercel + Neon accounts (`docs/DEPLOY.md`). |

## Roadmap

**Near term**
- Auth.js sessions + merchant org model; scope every dashboard query + the
  refund/payment-link endpoints to the session.
- First licensed bank-rail adapter (UK open banking PIS) behind
  `BankRailProvider`.
- RLUSD settlement on Mainnet behind a feature flag; keep XRP for Testnet.
- Edge rate-limiting middleware; CSRF on dashboard mutations.

**Medium term**
- Live route/provider marketplace: real competitor quotes, a pluggable
  `RouteProvider`, agent negotiation.
- `ComplianceProvider` boundary: KYB on merchant onboarding, sanctions + KYC on
  first payout to a new payee.
- Webhook management UI (add/rotate endpoints, per-event subscriptions),
  signed-payload verifier snippet in more languages.
- Multi-region liquidity pools + an FX position/risk view on the ledger.

**Longer term**
- Agent credit (pay-after-settlement) via an underwriting partner.
- A published `@ora/node` + `@ora/react` SDK.
- SOC 2 controls, data-retention automation, DR runbooks.
