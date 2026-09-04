import { describe, it, expect } from "vitest";
import { money } from "@/lib/money/money";
import type { AgentPolicy } from "@/db/schema";
import {
  ParsedConstraintsSchema,
  effectiveConstraints,
  requiresApproval,
  hardSpendGuard,
} from "./policy";

const POLICY: AgentPolicy = {
  id: "pol_test",
  ownerCustomerId: "cus_test",
  name: "Kestrel Digital default",
  maxPaymentAmount: 500_000n, // £5,000
  maxDailySpendAmount: 1_000_000n, // £10,000
  policyCurrency: "GBP",
  maxFxSpreadBps: 60,
  maxProcessingFeeBps: 100,
  requiredSettlementSeconds: 60,
  autoApproveUnderAmount: 400_000n, // £4,000
  approvedCurrencies: ["GBP", "SGD"],
  approvedMerchantIds: [],
  approvedProviders: null,
  requireApprovalForNewPayee: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("parsed constraints", () => {
  it("parses the demo objective's structured constraints", () => {
    const parsed = ParsedConstraintsSchema.parse({
      requiredSettlementCurrency: "SGD",
      maxProcessingFeeBps: 100,
      requiredSettlementSeconds: 60,
      approvalIfOverAmountMinor: 400_000,
      approvalIfOverCurrency: "GBP",
      deadline: "today",
    });
    expect(parsed.requiredSettlementCurrency).toBe("SGD");
  });
});

describe("effectiveConstraints — parsed only tightens", () => {
  it("takes the tighter of policy and objective", () => {
    const c = effectiveConstraints(
      POLICY,
      { maxProcessingFeeBps: 50, requiredSettlementSeconds: 120 },
      "SGD",
    );
    expect(c.maxProcessingFeeBps).toBe(50); // objective tighter
    expect(c.requiredSettlementSeconds).toBe(60); // policy tighter
    expect(c.maxFxSpreadBps).toBe(60); // unchanged
  });

  it("cannot be loosened past the policy", () => {
    const c = effectiveConstraints(POLICY, { maxFxSpreadBps: 9999 }, "SGD");
    expect(c.maxFxSpreadBps).toBe(60);
  });
});

describe("requiresApproval — deterministic gate", () => {
  it("requires approval for the £4,250 demo payment (over the £4,000 threshold + new payee)", () => {
    const d = requiresApproval({
      policy: POLICY,
      parsed: { approvalIfOverAmountMinor: 400_000 },
      amount: money(425_000n, "GBP"),
      isNewPayee: true,
      merchantId: "mrc_seed_marina",
    });
    expect(d.required).toBe(true);
    expect(d.reasons.join(" ")).toMatch(/auto-approve threshold/);
    expect(d.reasons.join(" ")).toMatch(/new payee/);
  });

  it("auto-approves a small payment to a known payee", () => {
    const d = requiresApproval({
      policy: { ...POLICY, approvedMerchantIds: ["mrc_known"] },
      parsed: {},
      amount: money(120_000n, "GBP"), // £1,200
      isNewPayee: false,
      merchantId: "mrc_known",
    });
    expect(d.required).toBe(false);
    expect(d.reasons).toEqual([]);
  });

  it("always requires approval above the per-payment cap", () => {
    const d = requiresApproval({
      policy: POLICY,
      parsed: {},
      amount: money(600_000n, "GBP"),
      isNewPayee: false,
      merchantId: "mrc_known",
    });
    expect(d.required).toBe(true);
    expect(d.reasons.join(" ")).toMatch(/per-payment limit/);
  });
});

describe("hardSpendGuard — LLM cannot override", () => {
  it("blocks over the per-payment cap", () => {
    expect(
      hardSpendGuard({ policy: POLICY, amount: money(600_000n, "GBP"), todaySpentMinor: 0n })
        .ok,
    ).toBe(false);
  });
  it("blocks over the daily cap", () => {
    expect(
      hardSpendGuard({
        policy: POLICY,
        amount: money(450_000n, "GBP"),
        todaySpentMinor: 800_000n,
      }).ok,
    ).toBe(false);
  });
  it("allows within caps", () => {
    expect(
      hardSpendGuard({
        policy: POLICY,
        amount: money(425_000n, "GBP"),
        todaySpentMinor: 0n,
      }).ok,
    ).toBe(true);
  });
});
