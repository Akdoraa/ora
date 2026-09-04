import { describe, it, expect } from "vitest";
import {
  money,
  moneyFromDecimal,
  add,
  subtract,
  applyBps,
  convert,
  impliedRate,
  toDecimalString,
  formatMoney,
  gt,
  lt,
} from "./money";

describe("money construction", () => {
  it("rejects non-integer number amounts (must be minor units)", () => {
    expect(() => money(12.5, "GBP")).toThrow();
  });

  it("parses decimal strings to minor units", () => {
    expect(moneyFromDecimal("4250.00", "GBP").amount).toBe(425_000n);
    expect(moneyFromDecimal("4250", "GBP").amount).toBe(425_000n);
    expect(moneyFromDecimal("0.01", "SGD").amount).toBe(1n);
    expect(moneyFromDecimal("1000", "JPY").amount).toBe(1000n);
  });

  it("round-trips through toDecimalString", () => {
    expect(toDecimalString(money(425_000n, "GBP"))).toBe("4250.00");
    expect(toDecimalString(money(1n, "SGD"))).toBe("0.01");
    expect(toDecimalString(money(-5n, "USD"))).toBe("-0.05");
    expect(toDecimalString(money(1000n, "JPY"))).toBe("1000");
  });
});

describe("arithmetic", () => {
  it("adds and subtracts same-currency amounts exactly", () => {
    expect(add(money(100n, "GBP"), money(250n, "GBP")).amount).toBe(350n);
    expect(subtract(money(100n, "GBP"), money(250n, "GBP")).amount).toBe(-150n);
  });

  it("refuses cross-currency arithmetic", () => {
    expect(() => add(money(1n, "GBP"), money(1n, "USD"))).toThrow(/currency mismatch/);
  });

  it("compares", () => {
    expect(gt(money(2n, "GBP"), money(1n, "GBP"))).toBe(true);
    expect(lt(money(1n, "GBP"), money(2n, "GBP"))).toBe(true);
  });
});

describe("applyBps (fees)", () => {
  it("computes a 1.00% processing fee on £4,250.00", () => {
    // 100 bps of 425000 minor = 4250 minor = £42.50
    expect(applyBps(money(425_000n, "GBP"), 100).amount).toBe(4_250n);
  });

  it("computes a 4.00% card baseline on £4,250.00", () => {
    expect(applyBps(money(425_000n, "GBP"), 400).amount).toBe(17_000n);
  });

  it("rounds half up by default", () => {
    // 1 bps of 12345 = 1.2345 -> 1
    expect(applyBps(money(12_345n, "GBP"), 1).amount).toBe(1n);
    // 15 bps of 1000 = 1.5 -> 2
    expect(applyBps(money(1_000n, "GBP"), 15).amount).toBe(2n);
  });
});

describe("convert (FX)", () => {
  it("converts GBP -> SGD at a rate and lands on minor units", () => {
    // £4,250.00 * 1.72 = S$7,310.00
    const out = convert(money(425_000n, "GBP"), "1.72", "SGD");
    expect(out.currency).toBe("SGD");
    expect(out.amount).toBe(731_000n);
  });

  it("handles differing minor-unit exponents (GBP->JPY)", () => {
    // £100.00 * 190.5 = ¥19050
    const out = convert(money(10_000n, "GBP"), "190.5", "JPY");
    expect(out.amount).toBe(19_050n);
  });

  it("impliedRate is the inverse of convert", () => {
    const from = money(425_000n, "GBP");
    const to = convert(from, "1.72", "SGD");
    expect(impliedRate(from, to)).toBe("1.72000000");
  });
});

describe("formatMoney", () => {
  it("formats GBP", () => {
    expect(formatMoney(money(425_000n, "GBP"))).toBe("£4,250.00");
  });
  it("formats RLUSD without a currency-code collision", () => {
    expect(formatMoney(money(50n, "RLUSD"))).toContain("0.50");
  });
});
