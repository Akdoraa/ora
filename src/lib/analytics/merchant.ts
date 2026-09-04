import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

const PAID = ["paid", "delivered", "partially_refunded", "refunded"] as const;
const FAILED = [
  "authorization_failed",
  "payment_failed",
  "settlement_failed",
  "fulfilment_failed",
  "expired",
  "cancelled",
] as const;

export interface MerchantOverview {
  merchant: typeof schema.merchants.$inferSelect;
  totalVolumeMinor: string;
  volumeCurrency: string;
  paymentsCount: number;
  paidCount: number;
  failedCount: number;
  successRatePct: number;
  avgSettlementSeconds: number | null;
  oraFeesMinor: string;
  cardEquivalentFeesMinor: string;
  savingsMinor: string;
  pendingSettlementsCount: number;
  agentOriginatedCount: number;
  humanOriginatedCount: number;
}

export async function merchantOverview(merchantId: string): Promise<MerchantOverview | null> {
  const db = await getDb();
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, merchantId))
    .limit(1);
  if (!merchant) return null;

  const rows = await db
    .select()
    .from(schema.paymentIntents)
    .where(eq(schema.paymentIntents.merchantId, merchantId));

  const paid = rows.filter((r) => (PAID as readonly string[]).includes(r.status));
  const failed = rows.filter((r) => (FAILED as readonly string[]).includes(r.status));
  const settledSeconds = paid
    .map((r) => r.settlementSeconds)
    .filter((s): s is number => typeof s === "number");

  const sum = (get: (r: (typeof rows)[number]) => bigint | null) =>
    rows.reduce((a, r) => a + (get(r) ?? 0n), 0n);

  const oraFees = paid.reduce((a, r) => a + (r.processingFeeAmount ?? 0n), 0n);
  const cardFees = paid.reduce((a, r) => a + (r.estimatedCardFeeAmount ?? 0n), 0n);
  const savings = paid.reduce((a, r) => a + (r.savingsVsCardAmount ?? 0n), 0n);

  return {
    merchant,
    totalVolumeMinor: sum((r) =>
      (PAID as readonly string[]).includes(r.status) ? r.amount : 0n,
    ).toString(),
    volumeCurrency: merchant.settlementCurrency,
    paymentsCount: rows.length,
    paidCount: paid.length,
    failedCount: failed.length,
    successRatePct:
      paid.length + failed.length === 0
        ? 100
        : Math.round((paid.length / (paid.length + failed.length)) * 1000) / 10,
    avgSettlementSeconds: settledSeconds.length
      ? Math.round(settledSeconds.reduce((a, b) => a + b, 0) / settledSeconds.length)
      : null,
    oraFeesMinor: oraFees.toString(),
    cardEquivalentFeesMinor: cardFees.toString(),
    savingsMinor: savings.toString(),
    pendingSettlementsCount: rows.filter((r) =>
      ["settling", "x402_quote_paid", "bank_confirmed", "awaiting_agent_approval"].includes(
        r.status,
      ),
    ).length,
    agentOriginatedCount: rows.filter((r) => r.origin === "agent").length,
    humanOriginatedCount: rows.filter((r) => r.origin === "human").length,
  };
}

export async function merchantPayments(merchantId: string, limit = 100) {
  const db = await getDb();
  return db
    .select({
      id: schema.paymentIntents.id,
      status: schema.paymentIntents.status,
      origin: schema.paymentIntents.origin,
      description: schema.paymentIntents.description,
      reference: schema.paymentIntents.reference,
      amount: schema.paymentIntents.amount,
      currency: schema.paymentIntents.currency,
      settlementAmount: schema.paymentIntents.settlementAmount,
      settlementCurrency: schema.paymentIntents.settlementCurrency,
      processingFeeAmount: schema.paymentIntents.processingFeeAmount,
      savingsVsCardAmount: schema.paymentIntents.savingsVsCardAmount,
      settlementSeconds: schema.paymentIntents.settlementSeconds,
      createdAt: schema.paymentIntents.createdAt,
      settledAt: schema.paymentIntents.settledAt,
    })
    .from(schema.paymentIntents)
    .where(eq(schema.paymentIntents.merchantId, merchantId))
    .orderBy(desc(schema.paymentIntents.createdAt))
    .limit(limit);
}

export async function merchantSettlements(merchantId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.settlements)
    .where(eq(schema.settlements.merchantId, merchantId))
    .orderBy(desc(schema.settlements.createdAt));

  const txIds = rows.map((r) => r.xrplTransactionId).filter((x): x is string => !!x);
  const txs = txIds.length
    ? await db
        .select()
        .from(schema.xrplTransactions)
        .where(inArray(schema.xrplTransactions.id, txIds))
    : [];
  const txById = Object.fromEntries(txs.map((t) => [t.id, t]));

  return rows.map((r) => ({
    ...r,
    xrplTransaction: r.xrplTransactionId ? txById[r.xrplTransactionId] : null,
  }));
}

export async function merchantWebhookLog(merchantId: string, limit = 50) {
  const db = await getDb();
  const endpoints = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.merchantId, merchantId));
  const ids = endpoints.map((e) => e.id);
  const deliveries = ids.length
    ? await db
        .select()
        .from(schema.webhookDeliveries)
        .where(inArray(schema.webhookDeliveries.endpointId, ids))
        .orderBy(desc(schema.webhookDeliveries.createdAt))
        .limit(limit)
    : [];
  return { endpoints, deliveries };
}

/** Daily volume series for the dashboard chart (last 14 buckets). */
export async function merchantVolumeSeries(merchantId: string, days = 14) {
  const db = await getDb();
  const rows = await db
    .select({
      day: sql<string>`to_char(${schema.paymentIntents.createdAt}, 'YYYY-MM-DD')`,
      status: schema.paymentIntents.status,
      amount: schema.paymentIntents.amount,
    })
    .from(schema.paymentIntents)
    .where(
      and(
        eq(schema.paymentIntents.merchantId, merchantId),
        sql`${schema.paymentIntents.createdAt} > now() - interval '${sql.raw(String(days))} days'`,
      ),
    );

  const buckets = new Map<string, bigint>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    buckets.set(d, 0n);
  }
  for (const r of rows) {
    if ((PAID as readonly string[]).includes(r.status)) {
      buckets.set(r.day, (buckets.get(r.day) ?? 0n) + r.amount);
    }
  }
  return [...buckets.entries()].map(([day, v]) => ({ day, volumeMinor: v.toString() }));
}
