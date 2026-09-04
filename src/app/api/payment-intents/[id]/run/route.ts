import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { getDb, schema } from "@/db/client";
import { getIntent } from "@/lib/payment-intents/service";
import { runAgent } from "@/lib/agent/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RunSchema = z.object({
  objective: z.string().min(4).max(1_000),
  policyId: z.string().min(1).optional(),
  bankSimulation: z.enum(["confirm", "fail", "expire"]).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, RunSchema);
  if (!parsed.ok) return parsed.res;

  const intent = await getIntent(id);
  if (!intent) return apiError(404, "not_found", `payment intent ${id} not found`);
  if (intent.status !== "created") {
    return apiError(409, "conflict", `intent is already ${intent.status}, cannot start a new run`);
  }

  let policyId = parsed.data.policyId ?? intent.agentPolicyId ?? undefined;
  if (!policyId) {
    const db = await getDb();
    const [pol] = await db.select().from(schema.agentPolicies).limit(1);
    policyId = pol?.id;
  }
  if (!policyId) return apiError(422, "no_policy", "no agent policy available");

  const result = await runAgent({
    intentId: id,
    objective: parsed.data.objective,
    policyId,
    bankSimulation: parsed.data.bankSimulation,
  });

  const status = result.status === "failed" ? 422 : 200;
  return NextResponse.json(jsonSafe({ paymentIntentId: id, ...result }), { status });
}
