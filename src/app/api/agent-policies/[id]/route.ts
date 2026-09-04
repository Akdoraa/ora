import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { apiError, parseBody } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { moneyFromDecimal } from "@/lib/money/money";
import { recordAuditEvent } from "@/lib/audit/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  maxPaymentAmountMajor: z.number().positive().optional(),
  maxDailySpendAmountMajor: z.number().positive().optional(),
  autoApproveUnderAmountMajor: z.number().nonnegative().optional(),
  maxFxSpreadBps: z.number().int().min(0).max(2_000).optional(),
  maxProcessingFeeBps: z.number().int().min(0).max(2_000).optional(),
  requiredSettlementSeconds: z.number().int().positive().max(604_800).optional(),
  approvedCurrencies: z.array(z.string().length(3)).min(1).optional(),
  requireApprovalForNewPayee: z.boolean().optional(),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = await getDb();
  const [policy] = await db
    .select()
    .from(schema.agentPolicies)
    .where(eq(schema.agentPolicies.id, id))
    .limit(1);
  if (!policy) return apiError(404, "not_found", "policy not found");
  return NextResponse.json(jsonSafe(policy));
}

/**
 * Update the standing AgentPolicy — the configurable controls a payer sets for
 * their agent (max payment, daily spend, FX/fee ceilings, settlement time,
 * approved currencies, new-payee approval). Hard caps are re-checked by the
 * executor at signing time regardless of what this endpoint stores.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(schema.agentPolicies)
    .where(eq(schema.agentPolicies.id, id))
    .limit(1);
  if (!existing) return apiError(404, "not_found", "policy not found");

  const parsed = await parseBody(req, PatchSchema);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;

  const patch: Partial<typeof schema.agentPolicies.$inferInsert> = {};
  if (b.maxPaymentAmountMajor !== undefined) {
    patch.maxPaymentAmount = moneyFromDecimal(
      b.maxPaymentAmountMajor,
      existing.policyCurrency,
    ).amount;
  }
  if (b.maxDailySpendAmountMajor !== undefined) {
    patch.maxDailySpendAmount = moneyFromDecimal(
      b.maxDailySpendAmountMajor,
      existing.policyCurrency,
    ).amount;
  }
  if (b.autoApproveUnderAmountMajor !== undefined) {
    patch.autoApproveUnderAmount = moneyFromDecimal(
      b.autoApproveUnderAmountMajor,
      existing.policyCurrency,
    ).amount;
  }
  if (b.maxFxSpreadBps !== undefined) patch.maxFxSpreadBps = b.maxFxSpreadBps;
  if (b.maxProcessingFeeBps !== undefined) patch.maxProcessingFeeBps = b.maxProcessingFeeBps;
  if (b.requiredSettlementSeconds !== undefined)
    patch.requiredSettlementSeconds = b.requiredSettlementSeconds;
  if (b.approvedCurrencies !== undefined)
    patch.approvedCurrencies = b.approvedCurrencies.map((c) => c.toUpperCase());
  if (b.requireApprovalForNewPayee !== undefined)
    patch.requireApprovalForNewPayee = b.requireApprovalForNewPayee;

  if (Object.keys(patch).length === 0) {
    return apiError(422, "no_changes", "no recognised fields in the request body");
  }

  // sanity: auto-approve threshold cannot exceed the per-payment cap
  const nextMax = patch.maxPaymentAmount ?? existing.maxPaymentAmount;
  const nextAuto = patch.autoApproveUnderAmount ?? existing.autoApproveUnderAmount;
  if (nextAuto > nextMax) {
    return apiError(
      422,
      "invalid_policy",
      "auto-approve threshold cannot exceed the max-per-payment cap",
    );
  }

  const [updated] = await db
    .update(schema.agentPolicies)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.agentPolicies.id, id))
    .returning();

  await recordAuditEvent({
    actor: "customer",
    type: "policy.updated",
    summary: `agent policy ${id} updated`,
    data: { fields: Object.keys(patch) },
  });

  return NextResponse.json(jsonSafe(updated));
}
