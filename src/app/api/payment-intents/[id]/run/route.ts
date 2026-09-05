import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { getIntent } from "@/lib/payment-intents/service";
import { runAgent } from "@/lib/agent/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RunSchema = z.object({
  objective: z.string().min(4).max(1_000),
  policyId: z.string().min(1).optional(),
  bankSimulation: z.enum(["confirm", "fail", "expire"]).optional(),
  /** the bank the phone+OTP identity step picked or already had on file */
  bankId: z.string().min(1).optional(),
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

  const policyId = parsed.data.policyId ?? intent.agentPolicyId ?? undefined;
  // No arbitrary "pick any policy in the table" fallback here on purpose:
  // AgentPolicy encodes one payer's own spend limits/approval thresholds,
  // so silently applying an unrelated policy (whichever row a LIMIT-1,
  // no-ORDER-BY scan happened to return) would gate this run against the
  // wrong guardrails entirely — looser OR stricter than intended, and
  // non-deterministic besides. Require an explicit source instead.
  if (!policyId) {
    return apiError(
      422,
      "no_policy",
      "no agent policy available — set policyId in the request or agentPolicyId on the payment intent",
    );
  }

  const result = await runAgent({
    intentId: id,
    objective: parsed.data.objective,
    policyId,
    bankSimulation: parsed.data.bankSimulation,
    bankId: parsed.data.bankId,
  });

  const status = result.status === "failed" ? 422 : 200;
  return NextResponse.json(jsonSafe({ paymentIntentId: id, ...result }), { status });
}
