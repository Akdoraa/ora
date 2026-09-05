/**
 * Deterministic demo seed: the UK → Singapore invoice scenario.
 *
 *   pnpm db:seed            # idempotent upsert
 *   pnpm demo:reset         # wipe demo rows first, then seed
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { seedId } from "@/lib/ids";
import { getWallet } from "@/lib/xrpl/wallets";
import { env } from "@/env";

const RESET = process.argv.includes("--reset");

const DEMO_API_KEY = "ora_sk_test_marina_9c2f4e7a1b8d";
const OBJECTIVE =
  "Pay invoice INV-4471 from Marina Analytics today. They must receive SGD. " +
  "Keep processing cost at or below 1%, use a qualified route, settle in under 60 seconds, " +
  "and ask for my approval if the final amount exceeds £4,000.";

async function main() {
  const db = await getDb();

  const IDS = {
    user: seedId("usr", "marina-owner"),
    merchant: seedId("mrc", "marina"),
    apiKey: seedId("key", "marina"),
    product: seedId("prod", "sea-report"),
    customer: seedId("cus", "kestrel"),
    policy: seedId("pol", "kestrel-default"),
    webhook: seedId("whe", "marina-test"),
  };

  if (RESET) {
    // wipe transactional rows for the demo merchant, keep the merchant/policy
    const intents = await db
      .select({ id: schema.paymentIntents.id })
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.merchantId, IDS.merchant));
    const ids = intents.map((i) => i.id);
    for (const table of [
      schema.auditEvents,
      schema.agentDecisions,
      schema.approvalRequests,
      schema.webhookDeliveries,
      schema.x402Payments,
      schema.xrplTransactions,
      schema.settlements,
      schema.fulfilments,
      schema.bankAuthorizations,
      schema.paymentRoutes,
      schema.ledgerEntries,
      schema.ledgerTransactions,
    ]) {
      // best-effort: delete rows referencing these intents
      for (const id of ids) {
        await db.delete(table).where(
          // @ts-expect-error dynamic column
          table.paymentIntentId ? eq(table.paymentIntentId, id) : eq(table.id, "__none__"),
        );
      }
    }
    for (const id of ids) {
      await db.delete(schema.paymentIntents).where(eq(schema.paymentIntents.id, id));
    }
    console.log(`reset: cleared ${ids.length} demo payment intent(s)`);
  }

  const merchantWallet = tryWallet("merchant");

  await db
    .insert(schema.users)
    .values({
      id: IDS.user,
      email: "ops@marina-analytics.example",
      name: "Marina Analytics Ops",
      role: "merchant",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.merchants)
    .values({
      id: IDS.merchant,
      ownerUserId: IDS.user,
      name: "Marina Analytics Pte Ltd",
      displayName: "Marina Analytics",
      country: "SG",
      settlementCurrency: "SGD",
      statementDescriptor: "MARINA ANALYTICS",
      processingFeeBps: 100,
      cardBaselineBps: 400,
      xrplPayoutAddress: merchantWallet,
    })
    .onConflictDoUpdate({
      target: schema.merchants.id,
      set: { xrplPayoutAddress: merchantWallet, processingFeeBps: 100, cardBaselineBps: 400 },
    });

  await db
    .insert(schema.apiKeys)
    .values({
      id: IDS.apiKey,
      merchantId: IDS.merchant,
      name: "Demo test key",
      prefix: DEMO_API_KEY.slice(0, 16),
      tokenHash: createHash("sha256").update(DEMO_API_KEY).digest("hex"),
      lastFour: DEMO_API_KEY.slice(-4),
      livemode: false,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.products)
    .values({
      id: IDS.product,
      merchantId: IDS.merchant,
      name: "Q3 2026 Southeast Asia Fintech Market Intelligence Report",
      description:
        "Q3 2026 SEA Fintech Market Intelligence Report (PDF + dataset) and 50,000 Marina API credits",
      kind: "report",
      priceAmount: 425_000n,
      priceCurrency: "GBP",
      deliverable: {
        kind: "report",
        title: "Q3 2026 Southeast Asia Fintech Market Intelligence Report",
        summary:
          "142-page market intelligence report with the full transaction dataset and 50,000 Marina API credits.",
        files: [
          { name: "sea-fintech-q3-2026.pdf", sizeLabel: "18.4 MB", contentType: "application/pdf" },
          { name: "sea-fintech-q3-2026-dataset.csv", sizeLabel: "6.1 MB", contentType: "text/csv" },
        ],
        apiCredentials: {
          apiKey: "sk_live_placeholder",
          credits: 50_000,
          baseUrl: "https://api.marina-analytics.example/v1",
        },
      },
    })
    .onConflictDoNothing();

  await db
    .insert(schema.customers)
    .values({
      id: IDS.customer,
      email: "procurement@kestrel-digital.example",
      name: "Kestrel Digital Ltd",
      // fictional UK "drama" number range (Ofcom-reserved for exactly this —
      // never a real subscriber), pre-linked so the checkout's phone+OTP
      // step can demo the *returning*-customer fast path out of the box
      phone: "+447700900123",
      country: "GB",
      holdingCurrency: "GBP",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.customerBankLinks)
    .values({
      id: seedId("cbl", "kestrel-monzo"),
      customerId: IDS.customer,
      provider: "ora_demo_bank",
      bankId: "gb-monzo",
      bankName: "Monzo",
      accountMask: "•••• 4821",
      status: "active",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.agentPolicies)
    .values({
      id: IDS.policy,
      ownerCustomerId: IDS.customer,
      name: "Kestrel Digital — default agent policy",
      maxPaymentAmount: 500_000n, // £5,000
      maxDailySpendAmount: 1_000_000n, // £10,000
      policyCurrency: "GBP",
      maxFxSpreadBps: 60, // 0.60%
      maxProcessingFeeBps: 100, // 1.00%
      requiredSettlementSeconds: 60,
      autoApproveUnderAmount: 400_000n, // £4,000 -> £4,250 forces approval
      approvedCurrencies: ["GBP", "SGD"],
      approvedMerchantIds: [],
      approvedProviders: null,
      requireApprovalForNewPayee: true,
    })
    .onConflictDoUpdate({
      target: schema.agentPolicies.id,
      set: {
        autoApproveUnderAmount: 400_000n,
        maxFxSpreadBps: 60,
        maxProcessingFeeBps: 100,
        requiredSettlementSeconds: 60,
      },
    });

  await db
    .insert(schema.webhookEndpoints)
    .values({
      id: IDS.webhook,
      merchantId: IDS.merchant,
      url: `${env.APP_URL}/api/webhooks/test`,
      secret: env.WEBHOOK_SIGNING_SECRET,
      enabledEvents: ["*"],
      active: true,
    })
    .onConflictDoNothing();

  console.log("\n✓ demo seeded\n");
  console.log(`  merchant      ${IDS.merchant}  (Marina Analytics, SGD)`);
  console.log(`  api key       ${DEMO_API_KEY}`);
  console.log(`  policy        ${IDS.policy}`);
  console.log(`  product       ${IDS.product}  (£4,250.00)`);
  console.log(`  customer      ${IDS.customer}  (Kestrel Digital, GBP)`);
  console.log(`  merchant XRPL ${merchantWallet}`);
  console.log(
    `  returning customer demo: enter +447700900123 at checkout — Monzo •••• 4821 is already linked`,
  );
  console.log(`\n  objective:\n  "${OBJECTIVE}"\n`);
  console.log("  Create an intent:");
  console.log(
    `  curl -sX POST ${env.APP_URL}/api/payment-intents -H "authorization: Bearer ${DEMO_API_KEY}" ` +
      `-H "content-type: application/json" -d '{"amount":425000,"currency":"GBP","settlementCurrency":"SGD",` +
      `"description":"Q3 2026 SEA Fintech Market Intelligence Report","reference":"INV-4471",` +
      `"productId":"${IDS.product}","customerId":"${IDS.customer}","agentPolicyId":"${IDS.policy}",` +
      `"origin":"agent","webhookUrl":"${env.APP_URL}/api/webhooks/test"}'\n`,
  );
}

function tryWallet(role: "merchant"): string | undefined {
  try {
    return getWallet(role).classicAddress;
  } catch {
    return undefined;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
