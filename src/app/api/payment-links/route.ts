import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, apiError } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { createPaymentIntent } from "@/lib/payment-intents/service";
import { currentMerchantId } from "@/lib/dashboard";
import { isSupportedCurrency } from "@/lib/money/currency";
import { env } from "@/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  amountMajor: z.number().positive(),
  currency: z.string().length(3),
  settlementCurrency: z.string().length(3).optional(),
  description: z.string().min(1).max(200),
  reference: z.string().max(80).optional(),
  method: z.enum(["bank", "qr", "agent"]).default("bank"),
});

/** Dashboard-only: create a payment link for the demo merchant. */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;
  if (!isSupportedCurrency(b.currency)) {
    return apiError(422, "unsupported_currency", `${b.currency} not supported`);
  }
  const exp = 100; // 2 dp
  const intent = await createPaymentIntent({
    merchantId: currentMerchantId(),
    amount: BigInt(Math.round(b.amountMajor * exp)),
    currency: b.currency,
    settlementCurrency: b.settlementCurrency,
    description: b.description,
    reference: b.reference,
    method: b.method,
    origin: b.method === "agent" ? "agent" : "human",
    webhookUrl: `${env.APP_URL}/api/webhooks/test`,
  });
  return NextResponse.json(
    jsonSafe({
      id: intent.id,
      checkoutUrl: `${env.APP_URL}/checkout/${intent.id}`,
      manifestUrl: `${env.APP_URL}/api/payment-intents/${intent.id}/manifest`,
    }),
    { status: 201 },
  );
}
