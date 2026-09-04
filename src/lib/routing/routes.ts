import Decimal from "decimal.js";
import {
  money,
  applyBps,
  convert,
  subtract,
  zero,
  type Money,
} from "@/lib/money/money";
import type { RouteKind, RouteQuote } from "./types";

/**
 * Seeded route catalogue. The Ora rail is real; the card / SWIFT / partner
 * quotes are clearly-labelled DEMO QUOTATIONS (isSynthetic) — never presented as
 * live market pricing.
 */
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

export const ROUTE_TEMPLATES: RouteTemplate[] = [
  {
    key: "ora-xrpl-rlusd",
    kind: "xrpl_rlusd",
    provider: "Ora XRPL + RLUSD rail",
    displayName: "Ora — bank → RLUSD on XRPL → bank",
    isSynthetic: false,
    processingFeeBps: 100, // 1.00%
    fxSpreadBps: 35, // 0.35%
    flatFeeMinor: 0n,
    estimatedSeconds: 6,
    reliabilityBps: 9920,
  },
  {
    key: "sg-fast-partner",
    kind: "domestic_rail",
    provider: "SG FAST / PayNow partner payout",
    displayName: "Partner FAST payout (bank FX)",
    isSynthetic: true,
    processingFeeBps: 80, // 0.80%
    fxSpreadBps: 190, // 1.90% bank FX — the catch
    flatFeeMinor: 0n,
    estimatedSeconds: 12,
    reliabilityBps: 9850,
  },
  {
    key: "global-card-demo",
    kind: "card_network",
    provider: "Global card network (demo quotation)",
    displayName: "Card network (demo quotation)",
    isSynthetic: true,
    processingFeeBps: 390, // 3.90%
    fxSpreadBps: 200, // 2.00%
    flatFeeMinor: 0n,
    estimatedSeconds: 172_800, // ~2 days to settled funds
    reliabilityBps: 9700,
  },
  {
    key: "swift-wire-demo",
    kind: "swift_wire",
    provider: "SWIFT correspondent wire (demo quotation)",
    displayName: "SWIFT wire (demo quotation)",
    isSynthetic: true,
    processingFeeBps: 30, // 0.30%
    fxSpreadBps: 120, // 1.20%
    flatFeeMinor: 1_800n, // ~£18 lifting fee
    estimatedSeconds: 172_800,
    reliabilityBps: 9600,
  },
];

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

export function buildCandidateRoutes(inp: QuoteInputs): RouteQuote[] {
  return ROUTE_TEMPLATES.map((t) => quoteRoute(t, inp));
}

export const noCost = (currency: string) => zero(currency);
