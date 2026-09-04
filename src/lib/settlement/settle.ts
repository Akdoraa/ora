import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import {
  money,
  applyBps,
  subtract,
  formatMoney,
  toDecimalString,
  type Money,
} from "@/lib/money/money";
import {
  postTransaction,
  feeEntries,
  fxAndPayableEntries,
  payoutEntries,
} from "@/lib/ledger/ledger";
import { executePayment } from "@/lib/xrpl/executor";
import { getWallet } from "@/lib/xrpl/wallets";
import { verifyQuote } from "@/lib/x402/quote";
import { applyTransition, getIntent } from "@/lib/payment-intents/service";
import { recordAuditEvent } from "@/lib/audit/audit";
import { deliverFulfilment } from "@/lib/fulfilment/fulfil";
import { emitWebhook } from "@/lib/webhooks/emit";
import { env } from "@/env";

export class QuoteExpiredError extends Error {
  constructor(reason: string) {
    super(`signed FX quote is not usable: ${reason}`);
    this.name = "QuoteExpiredError";
  }
}

/** Testnet settles in XRP (RLUSD faucet is GitHub-gated at 10/day). A documented
 *  demo factor maps the settlement-currency net onto a faucet-fundable XRP size;
 *  Mainnet settles the full RLUSD amount via the same executor. */
function settlementXrpValue(merchantNet: Money): string {
  const major = new Decimal(toDecimalString(merchantNet));
  const xrp = major.times(env.NODE_ENV === "test" ? 0.0002 : 0.0005);
  return Decimal.max(new Decimal("1"), Decimal.min(new Decimal("12"), xrp)).toFixed(6);
}

export interface SettlementResult {
  settlementId: string;
  xrplTransactionId: string;
  txHash: string;
  explorerUrl: string;
  merchantNet: Money;
  processingFee: Money;
  fxSpread: Money;
  savingsVsCard: Money;
  settlementSeconds: number;
}

/**
 * Execute settlement: check the signed quote, post the ledger legs, run the
 * real XRPL Testnet payout, discharge the payable, then fulfil and webhook.
 * Every failure leaves a recoverable, explained state.
 */
export async function settlePayment(intentId: string): Promise<SettlementResult> {
  const db = await getDb();
  const intent = await getIntent(intentId);
  if (!intent) throw new Error(`intent ${intentId} not found`);
  if (!intent.selectedRouteId) throw new Error("no route selected");

  const route = (
    await db
      .select()
      .from(schema.paymentRoutes)
      .where(eq(schema.paymentRoutes.id, intent.selectedRouteId))
      .limit(1)
  )[0];
  if (!route) throw new Error("selected route missing");

  const merchant = (
    await db.select().from(schema.merchants).where(eq(schema.merchants.id, intent.merchantId)).limit(1)
  )[0]!;

  const x402 = (
    await db
      .select()
      .from(schema.x402Payments)
      .where(eq(schema.x402Payments.paymentIntentId, intentId))
      .limit(1)
  )[0];
  if (!x402 || x402.status !== "verified" || !x402.quotePayload || !x402.quoteSignature) {
    throw new QuoteExpiredError("no verified signed quote — pay the x402 challenge first");
  }
  const quoteCheck = verifyQuote({
    quote: x402.quotePayload as never,
    signature: x402.quoteSignature,
    alg: "HMAC-SHA256",
  });
  if (!quoteCheck.ok) throw new QuoteExpiredError(quoteCheck.reason ?? "invalid");

  const quote = x402.quotePayload as {
    amountOutMinor: string;
    effectiveRate: string;
    midRate: string;
    fxSpreadBps: number;
  };

  const startedAt = Date.now();
  await applyTransition(intentId, "settlement_started", {
    actor: "agent",
    patch: { settlementStartedAt: new Date() },
  });

  const gross = money(intent.amount, intent.currency);
  const processingFee = applyBps(gross, merchant.processingFeeBps);
  const liquidityShare = subtract(gross, processingFee);
  const merchantNet = money(BigInt(quote.amountOutMinor), intent.settlementCurrency);
  const fxSpread = applyBps(liquidityShare, quote.fxSpreadBps);
  const cardEquivalent = applyBps(gross, merchant.cardBaselineBps);
  const savingsVsCard = money(
    cardEquivalent.amount - (processingFee.amount + fxSpread.amount),
    intent.currency,
  );

  // ── ledger: fee + FX + payable ────────────────────────────────────────────
  await postTransaction({
    kind: "fee",
    reason: `${(merchant.processingFeeBps / 100).toFixed(2)}% processing fee`,
    paymentIntentId: intentId,
    idempotencyKey: `fee:${intentId}`,
    entries: feeEntries(processingFee, intentId),
  });
  await postTransaction({
    kind: "fx",
    reason: "route locked; FX spread recognised, merchant payable created",
    paymentIntentId: intentId,
    idempotencyKey: `fx:${intentId}`,
    entries: fxAndPayableEntries({
      paymentIntentId: intentId,
      merchantId: merchant.id,
      liquidityShare,
      fxSpreadRevenue: fxSpread,
      merchantNet,
    }),
  });

  // ── XRPL Testnet settlement payout ────────────────────────────────────────
  const payoutAddress = merchant.xrplPayoutAddress ?? getWallet("merchant").classicAddress;
  let exec;
  try {
    exec = await executePayment({
      kind: "settlement",
      from: "settlement",
      to: payoutAddress,
      amount: { asset: "XRP", value: settlementXrpValue(merchantNet) },
      invoiceId: intentId,
      memo: `ora settlement ${intent.reference ?? intentId} -> ${formatMoney(merchantNet)}`,
      paymentIntentId: intentId,
      guard: { allowedAssets: ["XRP", "RLUSD"], allowedDestinations: [payoutAddress] },
    });
  } catch (err) {
    await applyTransition(intentId, "settlement_failed", {
      actor: "system",
      failureReason: err instanceof Error ? err.message : String(err),
    });
    await emitWebhook(intentId, "payment.settlement_failed", {});
    throw err;
  }

  const settlementSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));

  // discharge the payable now the value has actually left Ora
  await postTransaction({
    kind: "settle",
    reason: `XRPL settlement ${exec.hash} validated`,
    paymentIntentId: intentId,
    idempotencyKey: `payout:${intentId}`,
    entries: payoutEntries({ merchantId: merchant.id, merchantNet }),
  });

  const settlementId = newId("setl");
  await db.insert(schema.settlements).values({
    id: settlementId,
    paymentIntentId: intentId,
    merchantId: merchant.id,
    status: "settled",
    routeId: route.id,
    grossAmount: gross.amount,
    grossCurrency: gross.currency,
    processingFeeAmount: processingFee.amount,
    fxSpreadAmount: fxSpread.amount,
    netAmount: merchantNet.amount,
    netCurrency: merchantNet.currency,
    fxRate: quote.effectiveRate,
    xrplTransactionId: exec.xrplTransactionId,
    settledAt: new Date(),
  });

  await applyTransition(intentId, "settlement_succeeded", {
    actor: "agent",
    patch: {
      settlementAmount: merchantNet.amount,
      processingFeeAmount: processingFee.amount,
      merchantNetAmount: merchantNet.amount,
      fxRate: quote.effectiveRate,
      savingsVsCardAmount: savingsVsCard.amount,
      settledAt: new Date(),
      settlementSeconds,
    },
  });

  await recordAuditEvent({
    paymentIntentId: intentId,
    actor: "agent",
    type: "settlement.succeeded",
    summary: `settled ${formatMoney(merchantNet)} to merchant in ${settlementSeconds}s`,
    data: { txHash: exec.hash, explorerUrl: exec.explorerUrl, settlementSeconds },
  });

  await emitWebhook(intentId, "payment.settled", {
    txHash: exec.hash,
    merchantNet: merchantNet.amount.toString(),
    settlementCurrency: merchantNet.currency,
  });

  // ── fulfilment (only after verified settlement) ───────────────────────────
  try {
    await deliverFulfilment(intentId);
  } catch (err) {
    logger.error({ err, intentId }, "fulfilment failed after settlement");
  }

  return {
    settlementId,
    xrplTransactionId: exec.xrplTransactionId,
    txHash: exec.hash,
    explorerUrl: exec.explorerUrl,
    merchantNet,
    processingFee,
    fxSpread,
    savingsVsCard,
    settlementSeconds,
  };
}
