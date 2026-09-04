import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { apiError, parseBody } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { getDb, schema } from "@/db/client";
import { getIntent } from "@/lib/payment-intents/service";
import { approveAndContinue, rejectApproval } from "@/lib/agent/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ApproveSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  approvalId: z.string().optional(),
  decidedBy: z.string().default("payer"),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, ApproveSchema);
  if (!parsed.ok) return parsed.res;

  const intent = await getIntent(id);
  if (!intent) return apiError(404, "not_found", `payment intent ${id} not found`);
  if (intent.status !== "awaiting_agent_approval") {
    return apiError(409, "conflict", `intent is ${intent.status}, not awaiting approval`);
  }

  const db = await getDb();
  const [pending] = await db
    .select()
    .from(schema.approvalRequests)
    .where(
      and(
        eq(schema.approvalRequests.paymentIntentId, id),
        eq(schema.approvalRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) return apiError(409, "conflict", "no pending approval request");
  const approvalId = parsed.data.approvalId ?? pending.id;
  const decidedBy = parsed.data.decidedBy ?? "payer";

  if (parsed.data.decision === "reject") {
    await rejectApproval(id, approvalId, decidedBy);
    return NextResponse.json(jsonSafe({ paymentIntentId: id, status: "cancelled" }));
  }

  const result = await approveAndContinue(id, approvalId, decidedBy);
  const status = result.status === "failed" ? 422 : 200;
  return NextResponse.json(jsonSafe({ paymentIntentId: id, ...result }), { status });
}
