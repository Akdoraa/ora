import { describe, it, expect } from "vitest";
import { money, toNumber } from "@/lib/money/money";
import { buildCandidateRoutes } from "./routes";
import { evaluateRoutes, selectRoute } from "./qualify";
import type { EffectiveConstraints } from "./types";

const INPUTS = {
  gross: money(425_000n, "GBP"), // £4,250.00
  settlementCurrency: "SGD",
  midRate: "1.7180",
  cardBaselineBps: 400,
};

const CONSTRAINTS: EffectiveConstraints = {
  requiredSettlementCurrency: "SGD",
  maxProcessingFeeBps: 100,
  maxFxSpreadBps: 60,
  requiredSettlementSeconds: 60,
  minReliabilityBps: 9000,
};

describe("route catalogue", () => {
  it("produces four candidates and only the Ora rail is non-synthetic", () => {
    const routes = buildCandidateRoutes(INPUTS);
    expect(routes).toHaveLength(4);
    expect(routes.filter((r) => !r.isSynthetic).map((r) => r.key)).toEqual([
      "ora-xrpl-rlusd",
    ]);
  });

  it("quotes the Ora rail: 1% fee, merchant receives SGD, saves vs a 4% card", () => {
    const ora = buildCandidateRoutes(INPUTS).find((r) => r.key === "ora-xrpl-rlusd")!;
    expect(ora.processingFeeAmount.amount).toBe(4_250n); // £42.50 == 1.00%
    expect(ora.quotedSettlementAmount.currency).toBe("SGD");
    // ~S$7,190 at ~1.712 effective on £4,207.50
    expect(toNumber(ora.quotedSettlementAmount)).toBeGreaterThan(7_150);
    expect(toNumber(ora.quotedSettlementAmount)).toBeLessThan(7_230);
    expect(ora.cardEquivalentFeeAmount.amount).toBe(17_000n); // £170.00 == 4%
    expect(ora.savingsVsCardAmount.amount).toBeGreaterThan(0n);
  });
});

describe("qualification", () => {
  it("qualifies exactly the Ora rail and rejects the other three with reasons", () => {
    const evaluated = evaluateRoutes(buildCandidateRoutes(INPUTS), CONSTRAINTS);
    const byKey = Object.fromEntries(evaluated.map((r) => [r.key, r]));

    expect(byKey["ora-xrpl-rlusd"]!.status).toBe("qualified");
    expect(byKey["ora-xrpl-rlusd"]!.rejectionReasons).toEqual([]);

    expect(byKey["sg-fast-partner"]!.status).toBe("rejected");
    expect(byKey["sg-fast-partner"]!.rejectionReasons.join(" ")).toMatch(/FX spread/i);

    expect(byKey["global-card-demo"]!.status).toBe("rejected");
    expect(byKey["global-card-demo"]!.rejectionReasons.join(" ")).toMatch(
      /processing fee/i,
    );
    expect(byKey["global-card-demo"]!.rejectionReasons.join(" ")).toMatch(/settles in/i);

    expect(byKey["swift-wire-demo"]!.status).toBe("rejected");
    expect(byKey["swift-wire-demo"]!.rejectionReasons.join(" ")).toMatch(/settles in/i);
  });

  it("rejects the Ora rail too if the objective demands a sub-6s settlement", () => {
    const evaluated = evaluateRoutes(buildCandidateRoutes(INPUTS), {
      ...CONSTRAINTS,
      requiredSettlementSeconds: 3,
    });
    expect(evaluated.find((r) => r.key === "ora-xrpl-rlusd")!.status).toBe("rejected");
    expect(selectRoute(evaluated).selected).toBeUndefined();
  });
});

describe("selection", () => {
  it("selects the Ora rail and explains why", () => {
    const evaluated = evaluateRoutes(buildCandidateRoutes(INPUTS), CONSTRAINTS);
    const { selected, routes } = selectRoute(evaluated);
    expect(selected?.key).toBe("ora-xrpl-rlusd");
    expect(routes.find((r) => r.key === "ora-xrpl-rlusd")!.status).toBe("selected");
    expect(selected?.scoreExplanation).toMatch(/saving/i);
    expect(selected?.scoreExplanation).toMatch(/rejected/i);
  });

  it("prefers the cheaper qualified route when several qualify", () => {
    const evaluated = evaluateRoutes(buildCandidateRoutes(INPUTS), {
      ...CONSTRAINTS,
      maxProcessingFeeBps: 400,
      maxFxSpreadBps: 250,
      requiredSettlementSeconds: 200_000,
    });
    // now Ora, sg-fast, card, swift all qualify — Ora is cheapest all-in
    const { selected } = selectRoute(evaluated);
    expect(selected?.key).toBe("ora-xrpl-rlusd");
  });
});
