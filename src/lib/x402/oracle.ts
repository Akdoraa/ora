import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { NETWORK, explorerTxUrl } from "@/lib/xrpl/network";
import { verifyAndSettle } from "./facilitator";
import { buildQuoteRequirement } from "./server";
import { signQuote, type SignedFxQuote, type SignedQuoteEnvelope } from "./quote";

export interface QuoteRequest {
  paymentIntentId: string;
  amountInMinor: string;
  amountInCurrency: string;
  amountOutCurrency: string;
  /** mid-market reference rate; the oracle prices spread on top */
  midRate: string;
  fxSpreadBps: number;
  processingFeeBps: number;
}

export function invoiceIdFor(paymentIntentId: string): string {
  return `ora-x402-quote:${paymentIntentId}`;
}

/** Compute the FX quote the oracle will sign once payment settles. */
export function computeQuote(req: QuoteRequest): SignedFxQuote {
  const now = Date.now();
  const effectiveRate = new Decimal(req.midRate)
    .times(new Decimal(1).minus(new Decimal(req.fxSpreadBps).div(10_000)))
    .toFixed(8);
  const feeMinor = new Decimal(req.amountInMinor)
    .times(req.processingFeeBps)
    .div(10_000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const convertibleMinor = new Decimal(req.amountInMinor).minus(feeMinor);
  // presentment & settlement both 2dp in the demo
  const amountOutMinor = convertibleMinor
    .div(100)
    .times(effectiveRate)
    .times(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);

  return {
    quoteId: newId("x402"),
    pair: `${req.amountInCurrency}/${req.amountOutCurrency}`,
    midRate: req.midRate,
    effectiveRate,
    fxSpreadBps: req.fxSpreadBps,
    processingFeeBps: req.processingFeeBps,
    amountInMinor: req.amountInMinor,
    amountInCurrency: req.amountInCurrency,
    amountOutMinor: amountOutMinor.toFixed(0),
    amountOutCurrency: req.amountOutCurrency,
    issuedAt: now,
    validUntil: now + 5 * 60_000,
  };
}

export interface OracleResult {
  status: "payment_required" | "settled";
  envelope?: SignedQuoteEnvelope;
  settlementHash?: string;
  explorerUrl?: string;
  payer?: string | null;
  checks?: { name: string; ok: boolean; detail?: string }[];
}

/**
 * Server side of the x402-protected FX oracle. With no payment header -> 402.
 * With a valid presigned payment -> verify + settle on Testnet, then sign and
 * return the FX quote and persist the x402_payments + xrpl_transactions rows.
 */
export async function issueSignedQuote(params: {
  request: QuoteRequest;
  paymentHeader?: string | null;
}): Promise<OracleResult> {
  const { request } = params;
  const invoiceId = invoiceIdFor(request.paymentIntentId);
  const requirement = buildQuoteRequirement(invoiceId);
  const db = await getDb();

  // upsert the x402_payments row
  const existing = await db
    .select()
    .from(schema.x402Payments)
    .where(eq(schema.x402Payments.paymentIntentId, request.paymentIntentId))
    .limit(1);
  let rowId = existing[0]?.id;
  if (!rowId) {
    rowId = newId("x402");
    await db.insert(schema.x402Payments).values({
      id: rowId,
      paymentIntentId: request.paymentIntentId,
      resourceUrl: requirement.extra?.["resourceUrl"]?.toString() ?? "/api/x402/quote",
      invoiceId,
      status: "required",
      scheme: "exact",
      network: requirement.network,
      asset: requirement.asset,
      issuer: (requirement.extra?.["issuer"] as string) ?? null,
      amount: requirement.amount,
      payTo: requirement.payTo,
      paymentRequirements: requirement as unknown as Record<string, unknown>,
    });
  }

  if (!params.paymentHeader) {
    return { status: "payment_required" };
  }

  await db
    .update(schema.x402Payments)
    .set({ status: "paying" })
    .where(eq(schema.x402Payments.id, rowId));

  const { verify, settlement } = await verifyAndSettle({
    paymentHeader: params.paymentHeader,
    requirements: requirement,
    invoiceId,
  });

  if (!settlement.success) {
    await db
      .update(schema.x402Payments)
      .set({
        status: "failed",
        facilitatorResponse: verify as unknown as Record<string, unknown>,
        failureReason: settlement.errorReason ?? "settlement failed",
      })
      .where(eq(schema.x402Payments.id, rowId));
    logger.warn({ checks: verify.checks }, "x402 oracle: settlement failed");
    return { status: "payment_required", checks: verify.checks };
  }

  // record the on-chain x402 payment
  const xtxId = newId("xtx");
  await db.insert(schema.xrplTransactions).values({
    id: xtxId,
    paymentIntentId: request.paymentIntentId,
    kind: "x402_payment",
    status: "validated",
    network: NETWORK,
    account: settlement.payer ?? "",
    destination: requirement.payTo,
    asset: requirement.asset === "XRP" ? "XRP" : "RLUSD",
    amountDrops: requirement.asset === "XRP" ? requirement.amount : null,
    amountValue: requirement.asset === "XRP" ? null : requirement.amount,
    invoiceId,
    txHash: settlement.transaction,
    validated: true,
    engineResult: "tesSUCCESS",
    validatedAt: new Date(),
    explorerUrl: explorerTxUrl(settlement.transaction, NETWORK),
    rawResult: settlement as unknown as Record<string, unknown>,
  });

  const quote = computeQuote(request);
  const envelope = signQuote(quote);

  await db
    .update(schema.x402Payments)
    .set({
      status: "verified",
      xrplTransactionId: xtxId,
      facilitatorResponse: verify as unknown as Record<string, unknown>,
      quotePayload: envelope.quote as unknown as Record<string, unknown>,
      quoteSignature: envelope.signature,
      quoteExpiresAt: new Date(quote.validUntil),
    })
    .where(eq(schema.x402Payments.id, rowId));

  return {
    status: "settled",
    envelope,
    settlementHash: settlement.transaction,
    explorerUrl: explorerTxUrl(settlement.transaction, NETWORK),
    payer: settlement.payer ?? null,
    checks: verify.checks,
  };
}
