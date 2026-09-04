import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { toJsonb } from "@/lib/json";
import { money, formatMoney, toDecimalString } from "@/lib/money/money";
import { buildCandidateRoutes } from "@/lib/routing/routes";
import { evaluateRoutes, selectRoute } from "@/lib/routing/qualify";
import {
  effectiveConstraints,
  requiresApproval,
  type ParsedConstraints,
} from "@/lib/policies/policy";
import type { EvaluatedRoute } from "@/lib/routing/types";
import type { AgentPolicy, Merchant, PaymentIntent } from "@/db/schema";

const DEMO_MID_RATE: Record<string, string> = {
  "GBP/SGD": "1.7180",
  "GBP/USD": "1.2700",
  "USD/SGD": "1.3520",
  "EUR/SGD": "1.4600",
};

export function midRateFor(from: string, to: string): string {
  return DEMO_MID_RATE[`${from}/${to}`] ?? "1.0000";
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

/** listQualifiedRoutes — build candidate routes and persist them. */
export async function listAndPersistRoutes(intent: PaymentIntent, merchant: Merchant) {
  const db = await getDb();
  const candidates = buildCandidateRoutes({
    gross: money(intent.amount, intent.currency),
    settlementCurrency: intent.settlementCurrency,
    midRate: midRateFor(intent.currency, intent.settlementCurrency),
    cardBaselineBps: merchant.cardBaselineBps,
  });

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
