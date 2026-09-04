import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { money, applyBps, type Money } from "@/lib/money/money";
import { postTransaction, refundEntries } from "@/lib/ledger/ledger";
import { executePayment } from "@/lib/xrpl/executor";
import { getWallet } from "@/lib/xrpl/wallets";
import { applyTransition, getIntent } from "@/lib/payment-intents/service";
import { recordAuditEvent } from "@/lib/audit/audit";
import { emitWebhook } from "@/lib/webhooks/emit";
import { logger } from "@/lib/logger";

export interface RefundResult {
  refundId: string;
  status: string;
  amount: Money;
  xrplTxHash?: string;
  explorerUrl?: string;
}

/**
 * Full refund after settlement. Reverses Ora's fee + FX spread and the pool
 * share in the presentment currency, returns the gross to the customer, and
 * pushes an on-chain refund from the settlement wallet back to the payer agent
 * wallet (Testnet). Idempotent on `idempotencyKey`.
 */
export async function processRefund(params: {
  intentId: string;
  reason?: string;
  idempotencyKey?: string;
}): Promise<RefundResult> {
  const db = await getDb();
  const intent = await getIntent(params.intentId);
  if (!intent) throw new Error(`intent ${params.intentId} not found`);

  // Idempotency comes first, before the status guard: a caller retrying
  // (e.g. after a timeout) with the same key must get back the refund it
  // already triggered, even though `processRefund` itself has since moved
  // the intent's status to "refunded" or "partially_refunded" — which
  // would otherwise fail the status check below on every retry.
  if (params.idempotencyKey) {
    const [prior] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.idempotencyKey, params.idempotencyKey))
      .limit(1);
    if (prior) {
      return {
        refundId: prior.id,
        status: prior.status,
        amount: money(prior.amount, prior.currency),
      };
    }
  }

  if (!["paid", "delivered", "partially_refunded"].includes(intent.status)) {
    throw new Error(`cannot refund an intent in status ${intent.status}`);
  }

  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, intent.merchantId))
    .limit(1);

  const gross = money(intent.amount, intent.currency);
  const fee = money(intent.processingFeeAmount ?? applyBps(gross, merchant!.processingFeeBps).amount, intent.currency);
  const merchantNet = money(intent.merchantNetAmount ?? intent.settlementAmount ?? 0n, intent.settlementCurrency);
  // spread ≈ savings baseline math; recover from stored settlement if present
  const [settlement] = await db
    .select()
    .from(schema.settlements)
    .where(eq(schema.settlements.paymentIntentId, params.intentId))
    .limit(1);
  const fxSpread = money(settlement?.fxSpreadAmount ?? 0n, intent.currency);

  const refundId = newId("rfnd");
  await db.insert(schema.refunds).values({
    id: refundId,
    paymentIntentId: params.intentId,
    status: "processing",
    amount: gross.amount,
    currency: gross.currency,
    reason: params.reason,
    idempotencyKey: params.idempotencyKey,
  });

  // ledger reversal
  const ledger = await postTransaction({
    kind: "refund",
    reason: params.reason ?? "full refund",
    paymentIntentId: params.intentId,
    idempotencyKey: `refund:${refundId}`,
    entries: refundEntries({
      merchantId: intent.merchantId,
      grossToCustomer: gross,
      processingFee: fee,
      fxSpread,
      merchantNet,
    }),
  });

  // on-chain refund: settlement wallet -> payer agent wallet (Testnet, XRP)
  let xrplTxHash: string | undefined;
  let xrplTransactionId: string | undefined;
  let explorerUrl: string | undefined;
  try {
    const exec = await executePayment({
      kind: "refund",
      from: "settlement",
      to: getWallet("agent").classicAddress,
      amount: { asset: "XRP", value: "0.5" },
      invoiceId: `refund:${params.intentId}`,
      memo: `ora refund ${intent.reference ?? params.intentId}`,
      paymentIntentId: params.intentId,
      guard: { allowedAssets: ["XRP", "RLUSD"] },
    });
    xrplTxHash = exec.hash;
    xrplTransactionId = exec.xrplTransactionId;
    explorerUrl = exec.explorerUrl;
  } catch (err) {
    logger.warn({ err, intentId: params.intentId }, "on-chain refund leg failed (ledger reversal stands)");
  }

  await db
    .update(schema.refunds)
    .set({
      status: "succeeded",
      xrplTransactionId,
      ledgerTransactionId: ledger.ledgerTransactionId,
      processedAt: new Date(),
    })
    .where(eq(schema.refunds.id, refundId));

  await applyTransition(params.intentId, "refunded", {
    actor: "merchant",
    failureReason: undefined,
    data: { refundId, reason: params.reason },
  });
  await recordAuditEvent({
    paymentIntentId: params.intentId,
    actor: `merchant:${intent.merchantId}`,
    type: "refund.succeeded",
    summary: `full refund issued${xrplTxHash ? ` (XRPL ${xrplTxHash})` : ""}`,
  });
  await emitWebhook(params.intentId, "payment.refunded", { refundId, amount: gross.amount.toString() });

  return { refundId, status: "succeeded", amount: gross, xrplTxHash, explorerUrl };
}
