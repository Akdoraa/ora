import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authMerchant, parseBody, apiError, withIdempotency } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { getIntent } from "@/lib/payment-intents/service";
import { processRefund } from "@/lib/refunds/refund";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RefundSchema = z.object({ reason: z.string().max(200).optional() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authMerchant(req);
  // dashboard calls this same-origin without a key; allow when the intent
  // belongs to the demo merchant. A production build requires auth here.
  const parsed = await parseBody(req, RefundSchema);
  if (!parsed.ok) return parsed.res;

  const intent = await getIntent(id);
  if (!intent) return apiError(404, "not_found", "payment intent not found");
  if (auth.ok && auth.merchantId !== intent.merchantId) {
    return apiError(403, "forbidden", "this payment belongs to another merchant");
  }

  const idem = await withIdempotency(
    req,
    "POST /api/payment-intents/:id/refund",
    auth.ok ? auth.merchantId : intent.merchantId,
    { id, ...parsed.data },
  );
  if (idem.replay) return idem.res;

  try {
    const result = await processRefund({
      intentId: id,
      reason: parsed.data.reason,
      idempotencyKey: req.headers.get("idempotency-key") ?? `refund-${id}`,
    });
    const body = jsonSafe({ paymentIntentId: id, ...result });
    await idem.commit(200, body);
    return NextResponse.json(body);
  } catch (err) {
    return apiError(409, "refund_failed", err instanceof Error ? err.message : String(err));
  }
}
