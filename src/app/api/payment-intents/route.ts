import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authMerchant, parseBody, withIdempotency, apiError } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { createPaymentIntent } from "@/lib/payment-intents/service";
import { env } from "@/env";
import { isSupportedCurrency } from "@/lib/money/currency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  amount: z.number().int().positive(), // minor units
  currency: z.string().length(3),
  settlementCurrency: z.string().length(3).optional(),
  description: z.string().min(1).max(300),
  reference: z.string().max(80).optional(),
  productId: z.string().optional(),
  customerId: z.string().optional(),
  agentPolicyId: z.string().optional(),
  origin: z.enum(["human", "agent"]).optional(),
  method: z.enum(["bank", "qr", "agent"]).optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  expiresInSeconds: z.number().int().positive().max(86_400).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authMerchant(req);
  if (!auth.ok) return auth.res;

  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  if (!isSupportedCurrency(body.currency)) {
    return apiError(422, "unsupported_currency", `currency ${body.currency} is not supported`);
  }

  const idem = await withIdempotency(req, "POST /api/payment-intents", auth.merchantId, body);
  if (idem.replay) return idem.res;

  const intent = await createPaymentIntent({
    merchantId: auth.merchantId,
    amount: BigInt(body.amount),
    currency: body.currency,
    settlementCurrency: body.settlementCurrency,
    description: body.description,
    reference: body.reference,
    productId: body.productId,
    customerId: body.customerId,
    agentPolicyId: body.agentPolicyId,
    origin: body.origin,
    method: body.method,
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl,
    webhookUrl: body.webhookUrl,
    metadata: body.metadata,
    expiresInSeconds: body.expiresInSeconds,
  });

  const responseBody = jsonSafe({
    id: intent.id,
    object: "payment_intent",
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
    settlementCurrency: intent.settlementCurrency,
    description: intent.description,
    reference: intent.reference,
    checkoutUrl: `${env.APP_URL}/checkout/${intent.id}`,
    manifestUrl: `${env.APP_URL}/api/payment-intents/${intent.id}/manifest`,
    statusUrl: `${env.APP_URL}/api/payment-intents/${intent.id}/status`,
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt,
  });

  await idem.commit(201, responseBody);
  return NextResponse.json(responseBody, { status: 201 });
}
