import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authMerchant, parseBody, apiError, withIdempotency } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { getIntent } from "@/lib/payment-intents/service";
import { processRefund } from "@/lib/refunds/refund";
import { currentMerchantId } from "@/lib/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RefundSchema = z.object({ reason: z.string().max(200).optional() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authMerchant(req);
  const parsed = await parseBody(req, RefundSchema);
  if (!parsed.ok) return parsed.res;

  const intent = await getIntent(id);
  if (!intent) return apiError(404, "not_found", "payment intent not found");
  if (auth.ok) {
    if (auth.merchantId !== intent.merchantId) {
      return apiError(403, "forbidden", "this payment belongs to another merchant");
    }
  } else if (intent.merchantId !== currentMerchantId()) {
    // dashboard calls this same-origin without a key; allow ONLY when the
    // intent belongs to the demo merchant the dashboard is scoped to.
    // Anything else must present a valid API key — without this check, an
    // unauthenticated (or wrong-key) caller could refund any merchant's
    // payment just by knowing its id, which isn't secret (it's in checkout
    // URLs, receipts, webhooks). A production build requires auth here.
    return auth.res;
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
