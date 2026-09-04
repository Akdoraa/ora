import { createHash } from "node:crypto";
import { getDb, schema } from "@/db/client";
import { seedId, newId } from "@/lib/ids";

export async function createMerchant(overrides: Partial<typeof schema.merchants.$inferInsert> = {}) {
  const db = await getDb();
  const id = overrides.id ?? seedId("mrc", "marina");
  await db
    .insert(schema.merchants)
    .values({
      id,
      name: "Marina Analytics Pte Ltd",
      displayName: "Marina Analytics",
      country: "SG",
      settlementCurrency: "SGD",
      processingFeeBps: 100,
      cardBaselineBps: 400,
      xrplPayoutAddress: "r3Tcd4wX8trtKZxSBq35Z2e2ybA7ujucDn",
      ...overrides,
    })
    .onConflictDoNothing();
  return id;
}

/** Inserts an API key row and returns the plaintext token to send as a Bearer header. */
export async function createApiKey(
  overrides: Partial<typeof schema.apiKeys.$inferInsert> & { merchantId: string },
) {
  const db = await getDb();
  const id = overrides.id ?? newId("key");
  const token = `ora_sk_test_${newId("key").split("_")[1]}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.insert(schema.apiKeys).values({
    id,
    name: "test key",
    prefix: token.slice(0, 16),
    tokenHash,
    lastFour: token.slice(-4),
    livemode: false,
    ...overrides,
  });
  return { id, token };
}

export async function createAgentPolicy(
  overrides: Partial<typeof schema.agentPolicies.$inferInsert> = {},
) {
  const db = await getDb();
  const id = overrides.id ?? newId("pol");
  await db.insert(schema.agentPolicies).values({
    id,
    name: "Default policy",
    policyCurrency: "GBP",
    maxPaymentAmount: 400_000n,
    maxDailySpendAmount: 1_000_000n,
    autoApproveUnderAmount: 100_000n,
    approvedCurrencies: ["GBP", "SGD"],
    ...overrides,
  });
  return { id };
}

export async function createPaymentIntent(
  overrides: Partial<typeof schema.paymentIntents.$inferInsert> = {},
) {
  const db = await getDb();
  const merchantId = overrides.merchantId ?? (await createMerchant());
  const id = overrides.id ?? newId("pi");
  await db.insert(schema.paymentIntents).values({
    id,
    merchantId,
    description: "Q3 2026 SEA Fintech Market Intelligence Report + 50,000 API credits",
    reference: "INV-4471",
    amount: 425_000n,
    currency: "GBP",
    settlementCurrency: "SGD",
    status: "created",
    origin: "agent",
    method: "bank",
    ...overrides,
  });
  return { id, merchantId };
}
