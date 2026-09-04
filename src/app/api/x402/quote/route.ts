import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  paymentRequiredResponse,
  encodePaymentResponseHeader,
  HEADER_PAYMENT_SIGNATURE,
  HEADER_PAYMENT_RESPONSE,
} from "@/lib/x402/server";
import { issueSignedQuote, invoiceIdFor } from "@/lib/x402/oracle";
import { NETWORK_CAIP2 } from "@/lib/xrpl/network";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  paymentIntentId: z.string().min(1),
  amountInMinor: z.string().regex(/^\d+$/),
  amountInCurrency: z.string().length(3),
  amountOutCurrency: z.string().length(3),
  midRate: z.string().regex(/^\d+(\.\d+)?$/),
  fxSpreadBps: z.number().int().min(0).max(2_000),
  processingFeeBps: z.number().int().min(0).max(2_000),
});

/**
 * Ora's x402-protected FX & liquidity oracle.
 *
 *   POST /api/x402/quote            -> 402 Payment Required (PAYMENT-REQUIRED header)
 *   POST /api/x402/quote + payment  -> 200 { quote, signature, alg } (PAYMENT-RESPONSE header)
 *
 * The signed quote LOCKS the settlement FX rate; the settlement executor refuses
 * to convert without a valid, unexpired one.
 */
export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_request", detail: err instanceof z.ZodError ? err.issues : String(err) },
      { status: 400 },
    );
  }

  const paymentHeader = req.headers.get(HEADER_PAYMENT_SIGNATURE);

  const result = await issueSignedQuote({ request: body, paymentHeader });

  if (result.status === "payment_required") {
    const pr = paymentRequiredResponse({
      resourceUrl: req.nextUrl.toString(),
      invoiceId: invoiceIdFor(body.paymentIntentId),
    });
    logger.info({ paymentIntentId: body.paymentIntentId }, "x402 quote: issued 402 challenge");
    return NextResponse.json(pr.body, { status: 402, headers: pr.headers });
  }

  const paymentResponseHeader = encodePaymentResponseHeader({
    success: true,
    transaction: result.settlementHash!,
    network: NETWORK_CAIP2,
    payer: result.payer ?? null,
    extensions: { explorerUrl: result.explorerUrl },
  });

  return NextResponse.json(result.envelope, {
    status: 200,
    headers: {
      [HEADER_PAYMENT_RESPONSE]: paymentResponseHeader,
      "x-ora-x402-checks": JSON.stringify(result.checks ?? []),
    },
  });
}
