import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { getDb, schema } from "@/db/client";
import { getIntent } from "@/lib/payment-intents/service";
import { toDecimalString, money } from "@/lib/money/money";
import { env } from "@/env";
import { NETWORK_CAIP2 } from "@/lib/xrpl/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agent-readable payment manifest. An autonomous agent can discover the offer,
 * the amount, the accepted rails, and how to drive the payment without scraping
 * the visual checkout.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const intent = await getIntent(id);
  if (!intent) return apiError(404, "not_found", `payment intent ${id} not found`);

  const db = await getDb();
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, intent.merchantId))
    .limit(1);
  const [product] = intent.productId
    ? await db.select().from(schema.products).where(eq(schema.products.id, intent.productId)).limit(1)
    : [];

  const base = `${env.APP_URL}/api/payment-intents/${id}`;

  return NextResponse.json(
    jsonSafe({
      "@context": "https://ora.cash/schemas/payment-manifest/v1",
      object: "payment_manifest",
      paymentIntentId: id,
      status: intent.status,
      merchant: {
        name: merchant?.displayName,
        country: merchant?.country,
        acceptsAgentPayments: true,
      },
      offer: {
        description: intent.description,
        reference: intent.reference,
        product: product
          ? { name: product.name, kind: product.kind, deliverable: product.deliverable }
          : undefined,
      },
      amount: {
        value: toDecimalString(money(intent.amount, intent.currency)),
        minorUnits: intent.amount.toString(),
        currency: intent.currency,
      },
      settlement: { currency: intent.settlementCurrency, network: NETWORK_CAIP2 },
      pricing: {
        processingFeeBps: merchant?.processingFeeBps,
        cardBaselineBps: merchant?.cardBaselineBps,
        note: "Ora charges the merchant a flat 1% processing fee; FX is disclosed separately.",
      },
      rails: ["ora_bank_pay", "xrpl_rlusd"],
      actions: {
        run: { method: "POST", url: `${base}/run`, body: { objective: "string", policyId: "string" } },
        approve: { method: "POST", url: `${base}/approve` },
        status: { method: "GET", url: `${base}/status` },
        x402Quote: {
          method: "POST",
          url: `${env.APP_URL}/api/x402/quote`,
          scheme: "x402/exact",
          note: "returns HTTP 402 with PAYMENT-REQUIRED; pay on XRPL to obtain the signed FX quote",
        },
      },
    }),
  );
}
