/**
 * Drive the full commercial loop against a running server, entirely over HTTP.
 * Produces two real XRPL Testnet transactions (x402 quote payment + settlement).
 *
 *   pnpm dev            # in one terminal
 *   pnpm demo:run       # in another
 */
import { appendFileSync } from "node:fs";
import { env } from "@/env";
import { seedId } from "@/lib/ids";

const BASE = env.APP_URL;
const API_KEY = "ora_sk_test_marina_9c2f4e7a1b8d";
const OBJECTIVE =
  "Pay invoice INV-4471 from Marina Analytics today. They must receive SGD. " +
  "Keep processing cost at or below 1%, use a qualified route, settle in under 60 seconds, " +
  "and ask for my approval if the final amount exceeds £4,000.";

async function j(res: Response) {
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return { _status: res.status, _raw: t };
  }
}

async function main() {
  console.log(`▶ Ora demo against ${BASE}\n`);

  // 1 — merchant creates a payment intent
  const createRes = await fetch(`${BASE}/api/payment-intents`, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount: 425_000,
      currency: "GBP",
      settlementCurrency: "SGD",
      description: "Q3 2026 Southeast Asia Fintech Market Intelligence Report",
      reference: "INV-4471",
      productId: seedId("prod", "sea-report"),
      customerId: seedId("cus", "kestrel"),
      agentPolicyId: seedId("pol", "kestrel-default"),
      origin: "agent",
      webhookUrl: `${BASE}/api/webhooks/test`,
    }),
  });
  const intent = await j(createRes);
  if (createRes.status !== 201) throw new Error(`create failed: ${JSON.stringify(intent)}`);
  console.log(`1. payment intent ${intent.id}  → ${intent.checkoutUrl}`);

  // 2 — the payer's agent runs the objective
  console.log(`2. agent run…`);
  const runRes = await fetch(`${BASE}/api/payment-intents/${intent.id}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objective: OBJECTIVE, policyId: seedId("pol", "kestrel-default") }),
  });
  const run = await j(runRes);
  console.log(`   → ${run.status}${run.reasons ? `: ${run.reasons.join("; ")}` : ""}`);

  // 3 — human approval (the £4,250 payment is over the £4,000 threshold)
  if (run.status === "awaiting_approval") {
    console.log(`3. payer approves…`);
    const apRes = await fetch(`${BASE}/api/payment-intents/${intent.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", decidedBy: "akdora" }),
    });
    const ap = await j(apRes);
    console.log(`   → ${ap.status}`);
    if (ap.status !== "completed") throw new Error(`approval flow failed: ${JSON.stringify(ap)}`);
    Object.assign(run, ap);
  } else if (run.status !== "completed") {
    throw new Error(`run did not complete: ${JSON.stringify(run)}`);
  }

  // 4 — verify both transactions independently
  console.log(`4. verifying XRPL Testnet transactions…`);
  const hashes = [
    ["x402 quote payment", run.x402Hash],
    ["settlement", run.txHash],
  ] as const;
  for (const [label, hash] of hashes) {
    const vRes = await fetch(`${BASE}/api/xrpl/transactions/${hash}`);
    const v = await j(vRes);
    console.log(
      `   ${label.padEnd(20)} ${hash}  ${v.success ? "✓ validated tesSUCCESS" : "✗ " + JSON.stringify(v)}`,
    );
  }

  // 5 — final state
  const finalRes = await fetch(`${BASE}/api/payment-intents/${intent.id}`);
  const agg = await j(finalRes);
  console.log(`\n5. final: ${agg.intent.status}`);
  console.log(`   merchant net   ${agg.intent.settlementAmount} ${agg.intent.settlementCurrency} minor`);
  console.log(`   processing fee ${agg.intent.processingFeeAmount} ${agg.intent.currency} minor`);
  console.log(`   saved vs 4%    ${agg.intent.savingsVsCardAmount} ${agg.intent.currency} minor`);
  console.log(`   settled in     ${agg.intent.settlementSeconds}s`);
  console.log(`   agent summary  ${agg.agentRun?.decisionSummary ?? "—"}`);

  // 6 — append to evidence
  const now = new Date().toISOString().slice(0, 10);
  appendFileSync(
    "docs/evidence/xrpl-transactions.md",
    `\n### run-demo ${now}\n` +
      `- payment intent \`${intent.id}\` — ${agg.intent.status}\n` +
      `- x402 quote payment: \`${run.x402Hash}\` — https://testnet.xrpl.org/transactions/${run.x402Hash}\n` +
      `- settlement: \`${run.txHash}\` — https://testnet.xrpl.org/transactions/${run.txHash}\n`,
  );
  console.log(`\n✓ appended hashes to docs/evidence/xrpl-transactions.md`);
}

main().catch((err) => {
  console.error("\n✗", err);
  process.exit(1);
});
