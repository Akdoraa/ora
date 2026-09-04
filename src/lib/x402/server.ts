import {
  encodePaymentRequiredHeader,
  base64EncodeUtf8,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
  HEADER_PAYMENT_RESPONSE,
  type PaymentRequired,
  type PaymentRequirements,
  type SettlementResponse,
} from "x402-xrpl";
import { xrpToDrops } from "xrpl";
import Decimal from "decimal.js";
import { env } from "@/env";
import { NETWORK_CAIP2 } from "@/lib/xrpl/network";
import { RLUSD_ISSUER, RLUSD_CURRENCY_HEX } from "@/lib/xrpl/assets";
import { getWalletAddress } from "@/lib/xrpl/wallets";

export {
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
  HEADER_PAYMENT_RESPONSE,
};

/** Encode a settlement result for the `PAYMENT-RESPONSE` header. */
export function encodePaymentResponseHeader(s: SettlementResponse): string {
  return base64EncodeUtf8(JSON.stringify(s));
}

export interface QuoteChallengeParams {
  resourceUrl: string;
  invoiceId: string;
  description?: string;
}

/** The x402 `exact` requirement Ora's FX oracle asks for. */
export function buildQuoteRequirement(invoiceId: string): PaymentRequirements {
  const asset = env.X402_QUOTE_ASSET;
  const amount =
    asset === "XRP"
      ? xrpToDrops(env.X402_QUOTE_PRICE)
      : new Decimal(env.X402_QUOTE_PRICE).toFixed(2);
  return {
    scheme: "exact",
    network: NETWORK_CAIP2,
    amount,
    asset: asset === "XRP" ? "XRP" : RLUSD_CURRENCY_HEX,
    payTo: getWalletAddress("oracle"),
    maxTimeoutSeconds: 300,
    extra: {
      invoiceId,
      sourceTag: env.XRPL_SOURCE_TAG,
      ...(asset === "RLUSD" ? { issuer: RLUSD_ISSUER } : {}),
    },
  };
}

export function buildPaymentRequired(params: QuoteChallengeParams): PaymentRequired {
  return {
    x402Version: 2,
    resource: {
      url: params.resourceUrl,
      description:
        params.description ?? "Ora signed FX & liquidity quote (locks the settlement rate)",
      mimeType: "application/json",
    },
    accepts: [buildQuoteRequirement(params.invoiceId)],
    error: "payment required to obtain a signed FX quote",
  };
}

/** Headers + body for a 402 response from a Next route handler. */
export function paymentRequiredResponse(params: QuoteChallengeParams): {
  status: 402;
  headers: Record<string, string>;
  body: PaymentRequired;
} {
  const body = buildPaymentRequired(params);
  return {
    status: 402,
    headers: {
      [HEADER_PAYMENT_REQUIRED]: encodePaymentRequiredHeader(body),
      "content-type": "application/json",
    },
    body,
  };
}
