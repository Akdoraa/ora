import { z } from "zod";
import { gt, type Money } from "@/lib/money/money";
import type { AgentPolicy } from "@/db/schema";
import type { EffectiveConstraints } from "@/lib/routing/types";

/**
 * Structured constraints the agent extracts from a natural-language objective.
 * These only ever *tighten* the standing AgentPolicy — never loosen it.
 */
export const ParsedConstraintsSchema = z.object({
  requiredSettlementCurrency: z.string().length(3).optional(),
  maxProcessingFeeBps: z.number().int().min(0).max(10_000).optional(),
  maxFxSpreadBps: z.number().int().min(0).max(10_000).optional(),
  requiredSettlementSeconds: z.number().int().positive().optional(),
  approvalIfOverAmountMinor: z.number().int().nonnegative().optional(),
  approvalIfOverCurrency: z.string().length(3).optional(),
  deadline: z.string().optional(), // free text, e.g. "today"
  notes: z.string().optional(),
});
export type ParsedConstraints = z.infer<typeof ParsedConstraintsSchema>;

const minBps = (a: number, b?: number) => (b === undefined ? a : Math.min(a, b));
const minSec = (a: number, b?: number) => (b === undefined ? a : Math.min(a, b));

/** Merge the standing policy with parsed constraints — tighter wins. */
export function effectiveConstraints(
  policy: AgentPolicy,
  parsed: ParsedConstraints,
  intentSettlementCurrency: string,
): EffectiveConstraints {
  return {
    requiredSettlementCurrency: (
      parsed.requiredSettlementCurrency ?? intentSettlementCurrency
    ).toUpperCase(),
    maxProcessingFeeBps: minBps(policy.maxProcessingFeeBps, parsed.maxProcessingFeeBps),
    maxFxSpreadBps: minBps(policy.maxFxSpreadBps, parsed.maxFxSpreadBps),
    requiredSettlementSeconds: minSec(
      policy.requiredSettlementSeconds,
      parsed.requiredSettlementSeconds,
    ),
    minReliabilityBps: 9000,
    approvedProviders: policy.approvedProviders ?? undefined,
  };
}

export interface ApprovalDecision {
  required: boolean;
  reasons: string[];
}

/**
 * Deterministic approval gate. The LLM cannot override this — if it says "no
 * approval needed" but this returns required, the run pauses for a human.
 */
export function requiresApproval(params: {
  policy: AgentPolicy;
  parsed: ParsedConstraints;
  /** final amount in the policy's currency */
  amount: Money;
  isNewPayee: boolean;
  merchantId: string;
}): ApprovalDecision {
  const reasons: string[] = [];
  const { policy, parsed, amount, isNewPayee, merchantId } = params;

  if (amount.currency !== policy.policyCurrency) {
    reasons.push(
      `amount currency ${amount.currency} differs from policy currency ${policy.policyCurrency}`,
    );
  }
  if (gt(amount, { amount: policy.maxPaymentAmount, currency: amount.currency })) {
    reasons.push(
      `amount exceeds the per-payment limit (${policy.maxPaymentAmount} ${policy.policyCurrency} minor units)`,
    );
  }
  if (
    gt(amount, { amount: policy.autoApproveUnderAmount, currency: amount.currency })
  ) {
    reasons.push(
      `amount is at/above the auto-approve threshold (${policy.autoApproveUnderAmount} ${policy.policyCurrency} minor units)`,
    );
  }
  if (
    parsed.approvalIfOverAmountMinor !== undefined &&
    amount.amount > BigInt(parsed.approvalIfOverAmountMinor)
  ) {
    reasons.push(
      `amount exceeds the objective's approval threshold (${parsed.approvalIfOverAmountMinor} minor units)`,
    );
  }
  if (
    policy.requireApprovalForNewPayee &&
    isNewPayee &&
    !(policy.approvedMerchantIds ?? []).includes(merchantId)
  ) {
    reasons.push("first payment to this merchant (policy requires approval for new payees)");
  }

  return { required: reasons.length > 0, reasons };
}

/** Hard spend caps the executor re-checks, independent of any LLM output. */
export function hardSpendGuard(params: {
  policy: AgentPolicy;
  amount: Money;
  todaySpentMinor: bigint;
}): { ok: boolean; violation?: string } {
  const { policy, amount, todaySpentMinor } = params;
  if (amount.amount > policy.maxPaymentAmount) {
    return { ok: false, violation: "per-payment cap exceeded" };
  }
  if (todaySpentMinor + amount.amount > policy.maxDailySpendAmount) {
    return { ok: false, violation: "daily spend cap exceeded" };
  }
  return { ok: true };
}
