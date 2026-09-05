import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { toJsonb } from "@/lib/json";
import { money, formatMoney, toDecimalString } from "@/lib/money/money";
import { buildCandidateRoutes, quoteLiveRoute, rlusdTargetFor, type QuoteInputs } from "@/lib/routing/routes";
import {
  liveAmmQuoteForRlusdOut,
  liveOrderBookQuoteForRlusdOut,
  liveCombinedQuoteForRlusdOut,
} from "@/lib/routing/xrpl-market";
import { evaluateRoutes, selectRoute } from "@/lib/routing/qualify";
import {
  effectiveConstraints,
  requiresApproval,
  type ParsedConstraints,
} from "@/lib/policies/policy";
import type { EvaluatedRoute } from "@/lib/routing/types";
import type { AgentPolicy, Merchant, PaymentIntent } from "@/db/schema";
import Decimal from "decimal.js";
import { logger } from "@/lib/logger";

// Curated demo mid-rates for the pairs the seeded scenario actually exercises —
// kept exact so the recorded evidence (docs/evidence/, README figures) never
// drifts. Anything else derives from RATE_VS_USD below rather than silently
// defaulting to 1:1.
const DEMO_MID_RATE: Record<string, string> = {
  "GBP/SGD": "1.7180",
  "GBP/USD": "1.2700",
  "USD/SGD": "1.3520",
  "EUR/SGD": "1.4600",
};

// Demo-only cross-rates (1 unit of X in USD) covering every currency the
// checkout / payment-link UI offers, so an uncurated pair still gets a
// plausible rate instead of silently pricing at 1:1.
const RATE_VS_USD: Record<string, string> = {
  USD: "1",
  GBP: "1.2700",
  EUR: "1.0850",
  SGD: "0.7396",
  AUD: "0.6500",
  HKD: "0.1280",
  JPY: "0.0067",
};

export function midRateFor(from: string, to: string): string {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return "1.0000";

  const direct = DEMO_MID_RATE[`${f}/${t}`];
  if (direct) return direct;

  const inverse = DEMO_MID_RATE[`${t}/${f}`];
  if (inverse) return new Decimal(1).div(inverse).toFixed(8);

  const fUsd = RATE_VS_USD[f];
  const tUsd = RATE_VS_USD[t];
  if (fUsd && tUsd) return new Decimal(fUsd).div(tUsd).toFixed(8);

  logger.warn({ from: f, to: t }, "midRateFor: no demo rate for this pair, defaulting to 1:1");
  return "1.0000";
}

/** discoverMerchantOffer — the agent reads the merchant's machine-readable offer. */
export function discoverMerchantOffer(intent: PaymentIntent, merchant: Merchant) {
  return {
    merchant: merchant.displayName,
    country: merchant.country,
    reference: intent.reference,
    description: intent.description,
    amount: toDecimalString(money(intent.amount, intent.currency)),
    currency: intent.currency,
    settlementCurrency: intent.settlementCurrency,
    acceptsAgentPayments: true,
    manifestUrl: `/api/payment-intents/${intent.id}/manifest`,
  };
}

/**
 * listQualifiedRoutes — build candidate routes and persist them.
 *
 * One candidate (Ora's own RLUSD inventory) needs no network call and is
 * always present. The other three are read live off the actual XRPL ledger
 * right now, sized to the RLUSD this exact payment needs:
 *   - the AMM pool's real reserves/fee (amm_info)
 *   - the native order book's real depth (book_offers)
 *   - both combined — real order-book liquidity first, the AMM for
 *     whatever's left — which is what XRPL's own payment engine actually
 *     does for a real cross-currency Payment
 * Never fabricated: if a query fails or the ledger can't fill the amount
 * that way, that candidate just isn't offered this run.
 */
export async function listAndPersistRoutes(intent: PaymentIntent, merchant: Merchant) {
  const db = await getDb();
  const quoteInputs: QuoteInputs = {
    gross: money(intent.amount, intent.currency),
    settlementCurrency: intent.settlementCurrency,
    midRate: midRateFor(intent.currency, intent.settlementCurrency),
    cardBaselineBps: merchant.cardBaselineBps,
  };

  const direct = buildCandidateRoutes(quoteInputs);
  const rlusdTarget = rlusdTargetFor(quoteInputs, midRateFor(intent.currency, "USD"));

  const [ammLive, bookLive, combinedLive] = await Promise.all([
    liveAmmQuoteForRlusdOut(rlusdTarget),
    liveOrderBookQuoteForRlusdOut(rlusdTarget),
    liveCombinedQuoteForRlusdOut(rlusdTarget),
  ]);

  const candidates = [
    ...direct,
    ...(ammLive
      ? [quoteLiveRoute("xrpl-amm-live", "Ora — XRPL AMM pool (live)", 7, ammLive, quoteInputs)]
      : []),
    ...(bookLive
      ? [
          quoteLiveRoute(
            "xrpl-orderbook-live",
            "Ora — XRPL order book (live)",
            8,
            bookLive,
            quoteInputs,
          ),
        ]
      : []),
    ...(combinedLive
      ? [
          quoteLiveRoute(
            "xrpl-combined-live",
            "Ora — XRPL order book + AMM (live)",
            8,
            combinedLive,
            quoteInputs,
          ),
        ]
      : []),
  ];

  const rows = candidates.map((r) => ({
    id: newId("route"),
    paymentIntentId: intent.id,
    kind: r.kind,
    provider: r.provider,
    displayName: r.displayName,
    status: "candidate" as const,
    processingFeeBps: r.processingFeeBps,
    fxSpreadBps: r.fxSpreadBps,
    totalCostAmount: r.totalCostAmount.amount,
    fxRate: r.fxRate,
    quotedSettlementAmount: r.quotedSettlementAmount.amount,
    estimatedSeconds: r.estimatedSeconds,
    reliabilityBps: r.reliabilityBps,
    isSynthetic: r.isSynthetic,
    quoteExpiresAt: new Date(Date.now() + 10 * 60_000),
  }));
  await db.insert(schema.paymentRoutes).values(rows);

  return candidates.map((c, i) => ({ ...c, dbId: rows[i]!.id }));
}

export interface EvaluationOutcome {
  constraints: ReturnType<typeof effectiveConstraints>;
  evaluated: EvaluatedRoute[];
  selected?: EvaluatedRoute;
  selectedDbId?: string;
}

/** evaluateRoutes — qualify against the effective constraints and pick a winner. */
export async function evaluateAndSelect(
  intent: PaymentIntent,
  policy: AgentPolicy,
  parsed: ParsedConstraints,
  candidates: (Awaited<ReturnType<typeof listAndPersistRoutes>>[number])[],
): Promise<EvaluationOutcome> {
  const db = await getDb();
  const constraints = effectiveConstraints(policy, parsed, intent.settlementCurrency);
  const evaluated = evaluateRoutes(candidates, constraints);
  const { routes, selected } = selectRoute(evaluated);

  const dbIdByKey = Object.fromEntries(candidates.map((c) => [c.key, c.dbId]));
  for (const r of routes) {
    await db
      .update(schema.paymentRoutes)
      .set({
        status: r.status,
        rejectionReasons: r.rejectionReasons,
        scoreExplanation: r.scoreExplanation,
      })
      .where(eq(schema.paymentRoutes.id, dbIdByKey[r.key]!));
  }

  return {
    constraints,
    evaluated: routes,
    selected,
    selectedDbId: selected ? dbIdByKey[selected.key] : undefined,
  };
}

/** requestHumanApproval — deterministic gate; creates an ApprovalRequest if needed. */
export async function maybeRequestApproval(params: {
  intent: PaymentIntent;
  policy: AgentPolicy;
  parsed: ParsedConstraints;
  isNewPayee: boolean;
}): Promise<{ required: boolean; reasons: string[]; approvalId?: string }> {
  const { intent, policy, parsed, isNewPayee } = params;
  const decision = requiresApproval({
    policy,
    parsed,
    amount: money(intent.amount, intent.currency),
    isNewPayee,
    merchantId: intent.merchantId,
  });
  if (!decision.required) return { required: false, reasons: [] };

  const db = await getDb();
  const approvalId = newId("apr");
  await db.insert(schema.approvalRequests).values({
    id: approvalId,
    paymentIntentId: intent.id,
    status: "pending",
    reason: decision.reasons.join("; "),
    requestedAmount: intent.amount,
    requestedCurrency: intent.currency,
    policySnapshot: toJsonb(policy),
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  return { required: true, reasons: decision.reasons, approvalId };
}

export function receiptFallback(params: {
  merchant: string;
  merchantNet: string;
  settlementSeconds: number;
  processingFee: string;
  savingsVsCard: string;
  txHash: string;
  x402Hash: string;
  deliverableTitle: string;
}): string {
  return [
    `Paid ${params.merchant}. They received ${params.merchantNet} in ${params.settlementSeconds}s.`,
    `Ora's processing fee was ${params.processingFee} — you saved ${params.savingsVsCard} versus a 4% card.`,
    `The agent bought a signed FX quote over x402 (XRPL tx ${params.x402Hash.slice(0, 12)}…), then settled on XRPL (tx ${params.txHash.slice(0, 12)}…).`,
    `"${params.deliverableTitle}" is unlocked.`,
  ].join(" ");
}

export function formatMoneyMinor(minor: bigint, currency: string): string {
  return formatMoney(money(minor, currency));
}
