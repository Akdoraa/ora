import { describe, it, expect } from "vitest";
import { parseObjectiveHeuristically } from "./parse-objective";

const D = { settlementCurrency: "SGD" };

describe("heuristic objective parser (demo-mode fallback)", () => {
  it("parses the seeded demo objective", () => {
    const c = parseObjectiveHeuristically(
      "Pay invoice INV-4471 from Marina Analytics today. They must receive SGD. " +
        "Keep processing cost at or below 1%, use a qualified route, settle in under 60 seconds, " +
        "and ask for my approval if the final amount exceeds £4,000.",
      D,
    );
    expect(c.requiredSettlementCurrency).toBe("SGD");
    expect(c.maxProcessingFeeBps).toBe(100);
    expect(c.requiredSettlementSeconds).toBe(60);
    expect(c.approvalIfOverAmountMinor).toBe(400_000);
    expect(c.approvalIfOverCurrency).toBe("GBP");
    expect(c.deadline).toBe("today");
  });

  it("handles minutes and a tighter fee", () => {
    const c = parseObjectiveHeuristically(
      "Send USD. Processing fee under 0.5%. Settle within 2 minutes.",
      { settlementCurrency: "GBP" },
    );
    expect(c.requiredSettlementCurrency).toBe("USD");
    expect(c.maxProcessingFeeBps).toBe(50);
    expect(c.requiredSettlementSeconds).toBe(120);
  });

  it("falls back to the policy settlement currency when unstated", () => {
    const c = parseObjectiveHeuristically("Pay this invoice as fast as possible.", D);
    expect(c.requiredSettlementCurrency).toBe("SGD");
    expect(c.approvalIfOverAmountMinor).toBeUndefined();
  });

  it("parses an FX-spread ceiling", () => {
    const c = parseObjectiveHeuristically("Pay EUR, keep the FX spread below 0.4%.", D);
    expect(c.maxFxSpreadBps).toBe(40);
  });
});
