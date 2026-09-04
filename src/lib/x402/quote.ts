import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/env";

/**
 * The economically-meaningful thing the x402 payment unlocks: a signed,
 * time-limited FX + liquidity quote that LOCKS the settlement rate. Without a
 * valid signed quote the settlement executor refuses to convert.
 */
export const SignedFxQuoteSchema = z.object({
  quoteId: z.string(),
  pair: z.string(), // "GBP/SGD"
  midRate: z.string(),
  effectiveRate: z.string(),
  fxSpreadBps: z.number().int(),
  processingFeeBps: z.number().int(),
  amountInMinor: z.string(), // presentment currency minor units
  amountInCurrency: z.string(),
  amountOutMinor: z.string(), // settlement currency minor units
  amountOutCurrency: z.string(),
  issuedAt: z.number(),
  validUntil: z.number(),
});
export type SignedFxQuote = z.infer<typeof SignedFxQuoteSchema>;

export interface SignedQuoteEnvelope {
  quote: SignedFxQuote;
  signature: string;
  alg: "HMAC-SHA256";
}

function canonical(q: SignedFxQuote): string {
  return JSON.stringify(q, Object.keys(q).sort());
}

export function signQuote(quote: SignedFxQuote): SignedQuoteEnvelope {
  const signature = createHmac("sha256", env.X402_QUOTE_SIGNING_SECRET)
    .update(canonical(quote))
    .digest("hex");
  return { quote, signature, alg: "HMAC-SHA256" };
}

export function verifyQuote(env0: SignedQuoteEnvelope): {
  ok: boolean;
  reason?: string;
} {
  const parsed = SignedFxQuoteSchema.safeParse(env0.quote);
  if (!parsed.success) return { ok: false, reason: "malformed quote" };
  const expected = createHmac("sha256", env.X402_QUOTE_SIGNING_SECRET)
    .update(canonical(parsed.data))
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(env0.signature, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad signature" };
  }
  if (Date.now() > parsed.data.validUntil) {
    return { ok: false, reason: "quote expired" };
  }
  return { ok: true };
}
