import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { deliverFulfilment, getDeliverable } from "@/lib/fulfilment/fulfil";
import { getIntent } from "@/lib/payment-intents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retrieve the delivered item with a one-time access token. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ paymentIntentId: string }> }) {
  const { paymentIntentId } = await ctx.params;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const deliverable = await getDeliverable(paymentIntentId, token);
  if (!deliverable) return apiError(403, "forbidden", "invalid or missing access token");
  return NextResponse.json(jsonSafe(deliverable));
}

/** Trigger fulfilment (idempotent; only works once the intent is `paid`). */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ paymentIntentId: string }> },
) {
  const { paymentIntentId } = await ctx.params;
  const intent = await getIntent(paymentIntentId);
  if (!intent) return apiError(404, "not_found", "payment intent not found");
  try {
    const fulfilment = await deliverFulfilment(paymentIntentId);
    return NextResponse.json(jsonSafe(fulfilment));
  } catch (err) {
    return apiError(409, "conflict", err instanceof Error ? err.message : String(err));
  }
}
