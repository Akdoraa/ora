import type { Money } from "@/lib/money/money";

export type RouteKind = "xrpl_rlusd" | "xrpl_amm" | "xrpl_orderbook";

export interface RouteQuote {
  key: string;
  kind: RouteKind;
  provider: string;
  displayName: string;
  /** always false now — every candidate is either Ora's own quoted rate or a
   * live XRPL AMM/order-book read; kept only so older stored rows still
   * deserialize. */
  isSynthetic: boolean;

  processingFeeBps: number;
  fxSpreadBps: number;
  flatFee: Money; // presentment currency, e.g. a SWIFT lifting fee
  estimatedSeconds: number;
  reliabilityBps: number; // 9920 = 99.20%

  /** effective FX rate this route would give (presentment -> settlement) */
  fxRate: string;
  /** what the merchant would receive, settlement currency */
  quotedSettlementAmount: Money;
  /** explicit Ora/processor fee, presentment currency */
  processingFeeAmount: Money;
  /** implicit FX cost vs mid, expressed in presentment currency */
  fxCostAmount: Money;
  /** processingFee + fxCost + flatFee, presentment currency */
  totalCostAmount: Money;
  /** estimated fee on a 4%-equivalent card, presentment currency */
  cardEquivalentFeeAmount: Money;
  savingsVsCardAmount: Money;
}

export type RouteStatus = "qualified" | "rejected" | "selected";

export interface EvaluatedRoute extends RouteQuote {
  status: RouteStatus;
  rejectionReasons: string[];
  scoreExplanation?: string;
}

export interface EffectiveConstraints {
  requiredSettlementCurrency: string;
  maxProcessingFeeBps: number;
  maxFxSpreadBps: number;
  requiredSettlementSeconds: number;
  minReliabilityBps: number;
  approvedProviders?: string[];
}
