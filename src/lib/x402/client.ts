import Decimal from "decimal.js";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  XRPLPresignedPaymentPayer,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
  HEADER_PAYMENT_RESPONSE,
  type PaymentRequirements,
} from "x402-xrpl";
import { getWallet, type WalletRole } from "@/lib/xrpl/wallets";
import { WSS_URL, NETWORK_CAIP2 } from "@/lib/xrpl/network";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { verifyQuote, type SignedQuoteEnvelope } from "./quote";

export class X402GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402GuardError";
  }
}

export interface X402PayOptions {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  fromRole: WalletRole;
  guard: {
    maxAmount: string; // in asset units (drops for XRP, decimal for IOU)
    allowedAsset: "XRP" | string; // "XRP" or currency hex
    expectedPayTo: string;
  };
  fetchImpl?: typeof fetch;
}

export interface X402PayResult {
  paid: boolean;
  resource: unknown;
  quoteEnvelope?: SignedQuoteEnvelope;
  settlementHash?: string;
  settlementExplorerUrl?: string;
  requirement?: PaymentRequirements;
  challengeSeenAt?: string;
}

/**
 * Agent-side x402 client. Makes the real HTTP request, handles the 402
 * challenge, applies deterministic guardrails, presigns an XRPL Payment with
 * the named wallet, retries with the payment proof, and verifies the signed
 * quote it gets back.
 */
export async function payForResource(opts: X402PayOptions): Promise<X402PayResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const method = opts.method ?? "POST";
  const jsonHeaders = { "content-type": "application/json" };
  const bodyInit = opts.body === undefined ? undefined : JSON.stringify(opts.body);

  const first = await doFetch(opts.url, { method, headers: jsonHeaders, body: bodyInit });

  if (first.status !== 402) {
    return { paid: false, resource: await safeJson(first) };
  }

  const headerB64 = first.headers.get(HEADER_PAYMENT_REQUIRED);
  const challenge = headerB64
    ? decodePaymentRequiredHeader(headerB64)
    : ((await safeJson(first)) as { accepts?: PaymentRequirements[] });
  const requirement = (challenge.accepts ?? []).find((r) => r.scheme === "exact");
  if (!requirement) throw new X402GuardError("no `exact` payment requirement offered");

  // ── deterministic guardrails (independent of any LLM) ──────────────────────
  const assetCode = requirement.asset;
  if (opts.guard.allowedAsset !== assetCode) {
    throw new X402GuardError(
      `x402 asset ${assetCode} is not the permitted ${opts.guard.allowedAsset}`,
    );
  }
  if (requirement.payTo !== opts.guard.expectedPayTo) {
    throw new X402GuardError(
      `x402 payTo ${requirement.payTo} is not the expected oracle ${opts.guard.expectedPayTo}`,
    );
  }
  if (new Decimal(requirement.amount).gt(new Decimal(opts.guard.maxAmount))) {
    throw new X402GuardError(
      `x402 price ${requirement.amount} exceeds guard max ${opts.guard.maxAmount}`,
    );
  }
  if (requirement.network !== NETWORK_CAIP2) {
    throw new X402GuardError(
      `x402 network ${requirement.network} is not ${NETWORK_CAIP2}`,
    );
  }

  logger.info(
    { url: opts.url, amount: requirement.amount, asset: assetCode, payTo: requirement.payTo },
    "x402: 402 challenge accepted, presigning payment",
  );

  const invoiceId =
    (requirement.extra?.["invoiceId"] as string | undefined) ??
    `ora-x402:${opts.url}`;

  const payer = new XRPLPresignedPaymentPayer({
    // SDK is pinned to xrpl@4 internally; the Wallet shape is compatible.
    wallet: getWallet(opts.fromRole) as never,
    network: NETWORK_CAIP2 as "xrpl:0" | "xrpl:1" | "xrpl:2",
    wsUrl: WSS_URL,
    invoiceBinding: "both",
  });
  const prepared = await payer.preparePayment(requirement, { invoiceId });

  const second = await doFetch(opts.url, {
    method,
    headers: { ...jsonHeaders, [HEADER_PAYMENT_SIGNATURE]: prepared.paymentHeader },
    body: bodyInit,
  });

  const resource = await safeJson(second);
  if (!second.ok) {
    throw new Error(
      `x402: paid request failed ${second.status}: ${JSON.stringify(resource)}`,
    );
  }

  const settleB64 = second.headers.get(HEADER_PAYMENT_RESPONSE);
  const settlement = settleB64 ? decodePaymentResponseHeader(settleB64) : undefined;

  const quoteEnvelope = (resource as { quote?: unknown; signature?: string; alg?: string })
    .signature
    ? (resource as SignedQuoteEnvelope)
    : undefined;
  if (quoteEnvelope) {
    const check = verifyQuote(quoteEnvelope);
    if (!check.ok) throw new Error(`x402: signed quote invalid — ${check.reason}`);
  }

  return {
    paid: true,
    resource,
    quoteEnvelope,
    settlementHash: settlement?.transaction,
    settlementExplorerUrl:
      (settlement?.extensions as { explorerUrl?: string } | undefined)?.explorerUrl ??
      (settlement?.transaction ? `${env.XRPL_EXPLORER_URL}/transactions/${settlement.transaction}` : undefined),
    requirement,
    challengeSeenAt: new Date().toISOString(),
  };
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
