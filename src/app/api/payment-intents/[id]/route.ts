import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { getIntentAggregate } from "@/lib/payment-intents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const agg = await getIntentAggregate(id);
  if (!agg) return apiError(404, "not_found", `payment intent ${id} not found`);
  return NextResponse.json(jsonSafe(agg));
}
