# Ora — demo script (~3 minutes)

Prioritise the working product. Setup: `pnpm setup && pnpm dev`, then open
`http://localhost:3000`.

1. **The problem (15s).** "Businesses lose roughly 4% of every sale to cards —
   and cards expire, decline, and settle in days. For B2B and SaaS that's a
   terrible trade." Land on the home page — "Pay by bank. Processing fees,
   solved."

2. **Merchant integration (15s).** `/dashboard/developers` — one API key, a
   `POST /api/payment-intents` call, a hosted `checkoutUrl` and a machine-
   readable `manifestUrl`. "The merchant changes their checkout, not their bank
   account."

3. **Open the checkout (10s).** Click **Live checkout** → `/demo`. A £4,250
   invoice from a Singapore merchant who wants SGD; the payer holds GBP. "Pay by
   bank — no card number, no expiry, no CVC."

4. **The objective (15s).** Click **Authorize with Ora agent**. Read the
   objective: *"…must receive SGD, keep processing cost ≤ 1%, settle in under 60
   seconds, ask for approval if the amount exceeds £4,000."*

5. **Discovery & comparison (30s).** The agent panel fills in: the parsed
   constraint chips, then **4 routes**. The Ora XRPL+RLUSD rail is **selected**
   (1.00% fee, 0.35% FX, ~6s). The other three are **rejected** with reasons —
   Partner FAST on a 1.9% bank FX spread, the card network on a 3.9% fee and a
   2-day settlement, a SWIFT wire on time. "Remove the agent and this is manual
   work."

6. **Human approval (15s).** £4,250 is over the £4,000 threshold *and* it's a
   new payee, so the agent pauses. Click **Approve £4,250.00**.

7. **x402 (20s).** The agent hits a real **HTTP 402** on Ora's FX oracle, pays
   for the signed FX quote with a **real XRPL Testnet transaction**, and gets a
   time-limited signed rate back. "That payment unlocks the rate the settlement
   uses — without it, the settlement executor refuses to convert."

8. **Settlement (20s).** A second **real XRPL Testnet transaction** pays the
   merchant. It auto-redirects to the receipt.

9. **Open a hash (15s).** Expand **Settlement details** and click the settlement
   hash → `testnet.xrpl.org` shows `tesSUCCESS` in a validated ledger.

10. **The outcome (15s).** The report + 50,000 API credits are unlocked on the
    receipt. Merchant received **S$7,203.19**, Ora fee **£42.50 (1%)**, **saved
    £112.77 vs a 4% card**, settled in **~6 seconds**.

11. **Merchant side (20s).** `/dashboard` — volume, **saved vs card**, avg
    settlement, the agent-vs-human split. `/dashboard/settlements` — the ledger
    trial balance reads **balanced** and each payment reconciles to its XRPL
    hash.

12. **Close.** "Ora is the checkout for people and AI agents. Pay by bank.
    Processing fees, solved."

### Headless version

```bash
pnpm dev            # terminal 1
pnpm demo:run       # terminal 2
```
Prints each step and the two real transaction hashes, and appends them to
`docs/evidence/xrpl-transactions.md`.

### Failure & edge-case demos

The hosted checkout renders every terminal state correctly (see
`src/components/checkout/checkout-client.tsx`), but only the happy path is
reachable by clicking through the UI — failures are triggered via the API's
`bankSimulation` param so the demo checkout itself stays uncluttered by a "make
this fail" button. To show a judge a failure path:

```bash
# create a fresh intent, then force the bank leg to decline:
curl -sX POST localhost:3000/api/payment-intents/<id>/run -H "content-type: application/json" \
  -d '{"objective":"Pay this today, keep cost under 1%, settle in 60s","bankSimulation":"fail"}'
# -> { "status": "failed", "error": "bank declined the authorization (insufficient funds)",
#      "failedStep": "confirmBankAuthorization" }
# GET .../status now reports "authorization_failed" with that reason.
```

Swap `"fail"` for `"expire"` to see the `expired` path instead. A rejected
human approval (`POST .../approve {"decision":"reject"}`) demonstrates
`cancelled`. A refund on any `paid`/`delivered` intent
(`POST .../refund`) demonstrates the reversal path, including a real on-chain
refund transaction — see `/dashboard/payments/<id>` afterward for the ledger
entries and audit trail.
