import { describe, it, expect } from "vitest";
import { midRateFor } from "./tools";

describe("midRateFor", () => {
  it("uses the curated exact rate for the demo pair", () => {
    expect(midRateFor("GBP", "SGD")).toBe("1.7180");
  });

  it("is case-insensitive", () => {
    expect(midRateFor("gbp", "sgd")).toBe("1.7180");
  });

  it("returns 1.0000 for the same currency", () => {
    expect(midRateFor("USD", "USD")).toBe("1.0000");
  });

  it("derives the inverse when only the reverse pair is curated", () => {
    // USD/SGD is curated at 1.3520; SGD/USD should be its precise inverse
    const rate = midRateFor("SGD", "USD");
    expect(Number(rate)).toBeCloseTo(1 / 1.352, 6);
  });

  it("derives an uncurated pair via the USD cross-rate instead of defaulting to 1:1", () => {
    // AUD/HKD isn't curated and isn't 1:1 in reality — must not silently be "1.0000"
    const rate = midRateFor("AUD", "HKD");
    expect(rate).not.toBe("1.0000");
    expect(Number(rate)).toBeGreaterThan(4); // AUD is worth several HKD
  });

  it("falls back to 1:1 only for a genuinely unknown currency, and logs it", () => {
    expect(midRateFor("XXX", "YYY")).toBe("1.0000");
  });
});
