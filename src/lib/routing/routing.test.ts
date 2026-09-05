import { describe, it, expect } from "vitest";
import { money, toNumber } from "@/lib/money/money";
import { buildCandidateRoutes, quoteLiveRoute, rlusdTargetFor } from "./routes";
import { evaluateRoutes, selectRoute } from "./qualify";
import { ammQuoteForRlusdOut, orderBookQuoteForRlusdOut } from "./xrpl-market";
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

describe("Ora's own direct-inventory route", () => {
  it("produces exactly one candidate, never synthetic", () => {
    const routes = buildCandidateRoutes(INPUTS);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.isSynthetic).toBe(false);
    expect(routes[0]!.key).toBe("ora-xrpl-rlusd");
  });

  it("quotes 1% fee, merchant receives SGD, saves vs a 4% card", () => {
    const ora = buildCandidateRoutes(INPUTS)[0]!;
    expect(ora.processingFeeAmount.amount).toBe(4_250n); // £42.50 == 1.00%
    expect(ora.quotedSettlementAmount.currency).toBe("SGD");
    // ~S$7,190 at ~1.712 effective on £4,207.50
    expect(toNumber(ora.quotedSettlementAmount)).toBeGreaterThan(7_150);
    expect(toNumber(ora.quotedSettlementAmount)).toBeLessThan(7_230);
    expect(ora.cardEquivalentFeeAmount.amount).toBe(17_000n); // £170.00 == 4%
    expect(ora.savingsVsCardAmount.amount).toBeGreaterThan(0n);
  });
});

describe("qualification and selection over the direct route", () => {
  it("qualifies and selects it under a normal policy", () => {
    const evaluated = evaluateRoutes(buildCandidateRoutes(INPUTS), CONSTRAINTS);
    expect(evaluated[0]!.status).toBe("qualified");
    const { selected } = selectRoute(evaluated);
    expect(selected?.key).toBe("ora-xrpl-rlusd");
    expect(selected?.scoreExplanation).toMatch(/saving/i);
  });

  it("rejects it if the objective demands a sub-6s settlement", () => {
    const evaluated = evaluateRoutes(buildCandidateRoutes(INPUTS), {
      ...CONSTRAINTS,
      requiredSettlementSeconds: 3,
    });
    expect(evaluated[0]!.status).toBe("rejected");
    expect(selectRoute(evaluated).selected).toBeUndefined();
  });
});

describe("rlusdTargetFor", () => {
  it("nets Ora's own fee before converting to the RLUSD/USD peg amount", () => {
    // £4,250 gross, minus 1% Ora fee = £4,207.50, at GBP/USD 1.2700 = $5,343.53
    const target = rlusdTargetFor(INPUTS, "1.2700");
    expect(Number(target)).toBeCloseTo(4_207.5 * 1.27, 1);
  });
});

describe("live XRPL AMM route (amm_info, reversed constant-product math)", () => {
  // Fixture captured from a real query against XRPL Testnet's live XRP/RLUSD
  // pool (amm_info) — see src/lib/routing/xrpl-market.ts for field meanings.
  const fakeAmmClient = {
    request: async () => ({
      result: {
        amm: {
          amount: "698730941100", // drops
          amount2: { value: "246237.4538109351" }, // RLUSD
          trading_fee: 501, // 0.501%, real on-ledger field
        },
      },
    }),
  };

  it("solves for the real XRP cost of a given RLUSD output, isolating slippage from the stated fee", async () => {
    const quote = await ammQuoteForRlusdOut(fakeAmmClient, "100");
    expect(quote).not.toBeNull();
    expect(quote!.venueFeeBps).toBeCloseTo(50.1, 1);
    // a $100 trade against a ~$246k pool should have negligible slippage
    expect(quote!.slippageBps).toBeLessThan(5);
    expect(Number(quote!.xrpDropsCost)).toBeGreaterThan(0);
  });

  it("declines to quote a trade that would drain the pool", async () => {
    const quote = await ammQuoteForRlusdOut(fakeAmmClient, "999999999");
    expect(quote).toBeNull();
  });

  it("feeds a real AMM read into the same deterministic route-scoring engine", async () => {
    const live = await ammQuoteForRlusdOut(fakeAmmClient, "100");
    const route = quoteLiveRoute("xrpl-amm-live", "Ora — XRPL AMM pool (live)", 7, live!, INPUTS);
    expect(route.fxSpreadBps).toBeGreaterThanOrEqual(50); // at least the real trading fee
    expect(route.processingFeeBps).toBe(100); // Ora's own margin, unchanged
    expect(route.kind).toBe("xrpl_amm");
  });
});

describe("live XRPL order book route (book_offers, real depth walk)", () => {
  // Fixture shaped like a real book_offers response — two funded offers at
  // different prices, respecting owner_funds.
  const fakeBookClient = {
    request: async () => ({
      result: {
        offers: [
          { TakerGets: { value: "1" }, TakerPays: "5000000", owner_funds: "1" }, // 5 XRP/RLUSD
          { TakerGets: { value: "10" }, TakerPays: "60000000", owner_funds: "10" }, // 6 XRP/RLUSD
        ],
      },
    }),
  };

  it("walks real depth and reports genuine slippage once the best offer is exhausted", async () => {
    const quote = await orderBookQuoteForRlusdOut(fakeBookClient, "5");
    expect(quote).not.toBeNull();
    expect(quote!.venueFeeBps).toBe(0); // a CLOB has no separate venue fee
    // 1 RLUSD at 5 XRP/RLUSD + 4 RLUSD at 6 XRP/RLUSD = 29 XRP for 5 RLUSD -> 5.8 XRP/RLUSD average
    expect(Number(quote!.xrpDropsCost)).toBeCloseTo(29_000_000, -3);
    expect(quote!.slippageBps).toBeGreaterThan(0);
  });

  it("declines to quote a trade the visible book can't fully fill", async () => {
    const quote = await orderBookQuoteForRlusdOut(fakeBookClient, "1000");
    expect(quote).toBeNull();
  });
});
