import Decimal from "decimal.js";
import {
  money,
  applyBps,
  convert,
  subtract,
  toDecimalString,
  zero,
  type Money,
} from "@/lib/money/money";
import type { LiveXrplQuote } from "./xrpl-market";
import type { RouteKind, RouteQuote } from "./types";

/** Ora's own margin — the same fee for the same service, however it sources
 * the RLUSD it pays out. Everything that differs between routes below lives
 * in `fxSpreadBps`, not here. */
export const ORA_SERVICE_FEE_BPS = 100; // 1.00%

/** All three candidates settle on the same XRPL ledger, so "reliability"
 * no longer distinguishes one rail from a flakier one (that only made sense
 * when comparing against non-XRPL rails) — it's XRPL's own historical
 * consensus uptime, shared by every route here. */
export const XRPL_RELIABILITY_BPS = 9950;

interface RouteTemplate {
  key: string;
  kind: RouteKind;
  provider: string;
  displayName: string;
  isSynthetic: boolean;
  processingFeeBps: number;
  fxSpreadBps: number;
  flatFeeMinor: bigint; // presentment currency
  estimatedSeconds: number;
  reliabilityBps: number;
}

/** Ora already holding RLUSD inventory and paying it out directly — no DEX
 * hop needed, so no live venue query either. The 0.35% here is Ora's own
 * quoted OTC-style spread for that inventory. */
export const ORA_DIRECT_TEMPLATE: RouteTemplate = {
  key: "ora-xrpl-rlusd",
  kind: "xrpl_rlusd",
  provider: "Ora XRPL + RLUSD rail",
  displayName: "Ora — bank → RLUSD on XRPL → bank",
  isSynthetic: false,
  processingFeeBps: ORA_SERVICE_FEE_BPS,
  fxSpreadBps: 35, // 0.35% — Ora's own quoted spread on its own inventory
  flatFeeMinor: 0n,
  estimatedSeconds: 6,
  reliabilityBps: XRPL_RELIABILITY_BPS,
};

export interface QuoteInputs {
  gross: Money; // presentment currency
  settlementCurrency: string;
  /** mid-market reference rate presentment -> settlement (decimal string) */
  midRate: string;
  /** card baseline for the savings comparison, basis points (e.g. 400 = 4%) */
  cardBaselineBps: number;
}

function effectiveRate(midRate: string, fxSpreadBps: number): string {
  return new Decimal(midRate)
    .times(new Decimal(1).minus(new Decimal(fxSpreadBps).div(10_000)))
    .toFixed(8);
}

export function quoteRoute(t: RouteTemplate, inp: QuoteInputs): RouteQuote {
  const cur = inp.gross.currency;
  const processingFeeAmount = applyBps(inp.gross, t.processingFeeBps);
  const flatFee = money(t.flatFeeMinor, cur);

  // amount that actually gets converted after Ora's fee
  const convertible = subtract(inp.gross, processingFeeAmount);
  const rate = effectiveRate(inp.midRate, t.fxSpreadBps);
  const quotedSettlementAmount = convert(convertible, rate, inp.settlementCurrency);

  // FX cost vs mid, as a share of the converted principal (presentment currency)
  const fxCostAmount = applyBps(convertible, t.fxSpreadBps);

  const totalCostAmount = money(
    processingFeeAmount.amount + fxCostAmount.amount + flatFee.amount,
    cur,
  );

  const cardEquivalentFeeAmount = applyBps(inp.gross, inp.cardBaselineBps);
  const savingsVsCardAmount = money(
    cardEquivalentFeeAmount.amount - totalCostAmount.amount,
    cur,
  );

  return {
    key: t.key,
    kind: t.kind,
    provider: t.provider,
    displayName: t.displayName,
    isSynthetic: t.isSynthetic,
    processingFeeBps: t.processingFeeBps,
    fxSpreadBps: t.fxSpreadBps,
    flatFee,
    estimatedSeconds: t.estimatedSeconds,
    reliabilityBps: t.reliabilityBps,
    fxRate: rate,
    quotedSettlementAmount,
    processingFeeAmount,
    fxCostAmount,
    totalCostAmount,
    cardEquivalentFeeAmount,
    savingsVsCardAmount,
  };
}

/** Ora's own direct-inventory route only — the one candidate that needs no
 * live network call, so it's always available even if XRPL itself is
 * unreachable. */
export function buildCandidateRoutes(inp: QuoteInputs): RouteQuote[] {
  return [quoteRoute(ORA_DIRECT_TEMPLATE, inp)];
}

/** The RLUSD amount (~USD, 1:1 peg) this payment needs after Ora's own fee —
 * what a live AMM/order-book quote needs to be sized against. */
export function rlusdTargetFor(inp: QuoteInputs, presentmentToUsdRate: string): string {
  const processingFeeAmount = applyBps(inp.gross, ORA_SERVICE_FEE_BPS);
  const convertible = subtract(inp.gross, processingFeeAmount);
  return toDecimalString(convert(convertible, presentmentToUsdRate, "USD"));
}

/** Turn one live XRPL market read into a full route quote, by building a
 * virtual template around it and reusing the exact same quoteRoute math as
 * Ora's own direct rail — same fee, same settlement-currency conversion,
 * only `fxSpreadBps` differs, and that number is entirely real (the venue's
 * own stated fee plus whatever real slippage walking its live depth cost). */
type LiveRouteKey = "xrpl-amm-live" | "xrpl-orderbook-live" | "xrpl-combined-live";

const LIVE_ROUTE_META: Record<LiveRouteKey, { kind: RouteKind; provider: string }> = {
  "xrpl-amm-live": { kind: "xrpl_amm", provider: "XRPL AMM (live pool)" },
  "xrpl-orderbook-live": { kind: "xrpl_orderbook", provider: "XRPL order book (live)" },
  "xrpl-combined-live": {
    kind: "xrpl_combined",
    provider: "XRPL order book + AMM (live, combined)",
  },
};

export function quoteLiveRoute(
  key: LiveRouteKey,
  displayName: string,
  estimatedSeconds: number,
  live: LiveXrplQuote,
  inp: QuoteInputs,
): RouteQuote {
  const meta = LIVE_ROUTE_META[key];
  const template: RouteTemplate = {
    key,
    kind: meta.kind,
    provider: meta.provider,
    displayName,
    isSynthetic: false,
    processingFeeBps: ORA_SERVICE_FEE_BPS,
    fxSpreadBps: Math.round(live.venueFeeBps + live.slippageBps),
    flatFeeMinor: 0n,
    estimatedSeconds,
    reliabilityBps: XRPL_RELIABILITY_BPS,
  };
  return quoteRoute(template, inp);
}

export const noCost = (currency: string) => zero(currency);
