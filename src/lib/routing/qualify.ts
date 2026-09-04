import { formatMoney } from "@/lib/money/money";
import type { EffectiveConstraints, EvaluatedRoute, RouteQuote } from "./types";

function humanSeconds(s: number): string {
  if (s < 90) return `~${s}s`;
  if (s < 5400) return `~${Math.round(s / 60)} min`;
  if (s < 172_800) return `~${Math.round(s / 3600)} h`;
  return `~${Math.round(s / 86_400)} days`;
}

/** Check one route against the effective constraints, collecting every failure. */
export function evaluateRoute(
  route: RouteQuote,
  c: EffectiveConstraints,
): EvaluatedRoute {
  const rejectionReasons: string[] = [];

  if (route.quotedSettlementAmount.currency !== c.requiredSettlementCurrency) {
    rejectionReasons.push(
      `settles in ${route.quotedSettlementAmount.currency}, not the required ${c.requiredSettlementCurrency}`,
    );
  }
  if (route.processingFeeBps > c.maxProcessingFeeBps) {
    rejectionReasons.push(
      `processing fee ${(route.processingFeeBps / 100).toFixed(2)}% exceeds the ${(
        c.maxProcessingFeeBps / 100
      ).toFixed(2)}% limit`,
    );
  }
  if (route.fxSpreadBps > c.maxFxSpreadBps) {
    rejectionReasons.push(
      `FX spread ${(route.fxSpreadBps / 100).toFixed(2)}% exceeds the ${(
        c.maxFxSpreadBps / 100
      ).toFixed(2)}% limit`,
    );
  }
  if (route.estimatedSeconds > c.requiredSettlementSeconds) {
    rejectionReasons.push(
      `settles in ${humanSeconds(route.estimatedSeconds)}, over the ${humanSeconds(
        c.requiredSettlementSeconds,
      )} requirement`,
    );
  }
  if (route.reliabilityBps < c.minReliabilityBps) {
    rejectionReasons.push(
      `reliability ${(route.reliabilityBps / 100).toFixed(1)}% is below the ${(
        c.minReliabilityBps / 100
      ).toFixed(1)}% floor`,
    );
  }
  if (c.approvedProviders && !c.approvedProviders.includes(route.provider)) {
    rejectionReasons.push(`provider "${route.provider}" is not on the approved list`);
  }

  return {
    ...route,
    status: rejectionReasons.length === 0 ? "qualified" : "rejected",
    rejectionReasons,
  };
}

export function evaluateRoutes(
  routes: RouteQuote[],
  c: EffectiveConstraints,
): EvaluatedRoute[] {
  return routes.map((r) => evaluateRoute(r, c));
}

/**
 * Pick the winner: lowest all-in cost among qualified routes, tie-broken by
 * settlement speed then reliability. Returns the list with the winner marked
 * `selected` and given a plain-language explanation.
 */
export function selectRoute(evaluated: EvaluatedRoute[]): {
  routes: EvaluatedRoute[];
  selected?: EvaluatedRoute;
} {
  const qualified = evaluated.filter((r) => r.status === "qualified");
  if (qualified.length === 0) return { routes: evaluated };

  const winner = [...qualified].sort(
    (a, b) =>
      Number(a.totalCostAmount.amount - b.totalCostAmount.amount) ||
      a.estimatedSeconds - b.estimatedSeconds ||
      b.reliabilityBps - a.reliabilityBps,
  )[0]!;

  const rejected = evaluated.filter((r) => r.status === "rejected");
  const explanation =
    `${winner.displayName}: ${(winner.processingFeeBps / 100).toFixed(2)}% processing fee ` +
    `+ ${(winner.fxSpreadBps / 100).toFixed(2)}% FX spread, settles in ${humanSeconds(
      winner.estimatedSeconds,
    )}, ` +
    `delivering ${formatMoney(winner.quotedSettlementAmount)} to the merchant. ` +
    `All-in cost ${formatMoney(winner.totalCostAmount)} vs ` +
    `${formatMoney(winner.cardEquivalentFeeAmount)} on a 4% card — ` +
    `saving ${formatMoney(winner.savingsVsCardAmount)}. ` +
    (rejected.length
      ? `${rejected.length} route${rejected.length > 1 ? "s" : ""} rejected: ` +
        rejected.map((r) => `${r.displayName} (${r.rejectionReasons[0]})`).join("; ") +
        "."
      : "");

  return {
    routes: evaluated.map((r) =>
      r.key === winner.key
        ? { ...r, status: "selected", scoreExplanation: explanation }
        : r,
    ),
    selected: { ...winner, status: "selected", scoreExplanation: explanation },
  };
}
