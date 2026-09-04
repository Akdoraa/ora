import { describe, it, expect, vi } from "vitest";

// env defaults are enough; force wallet addresses to be resolvable
vi.mock("@/lib/xrpl/wallets", () => ({
  getWalletAddress: () => "rB7fRYCLLj7V5ctcYtx3eVT42GABVaMh7H",
  getWallet: () => ({ classicAddress: "rB7fRYCLLj7V5ctcYtx3eVT42GABVaMh7H" }),
}));

import {
  encodePaymentRequiredHeader,
  decodePaymentRequiredHeader,
} from "x402-xrpl";
import { buildPaymentRequired, buildQuoteRequirement } from "./server";
import { signQuote, verifyQuote, type SignedFxQuote } from "./quote";
import { computeQuote } from "./oracle";

describe("x402 challenge", () => {
  it("builds a spec-shaped exact requirement on xrpl:1", () => {
    const req = buildQuoteRequirement("ora-x402-quote:pi_test");
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe("xrpl:1");
    expect(req.asset).toBe("XRP");
    expect(req.amount).toBe("1000000"); // 1 XRP in drops
    expect(req.extra?.invoiceId).toBe("ora-x402-quote:pi_test");
    expect(req.extra?.sourceTag).toBe(20260530);
  });

  it("round-trips through the PAYMENT-REQUIRED header", () => {
    const body = buildPaymentRequired({
      resourceUrl: "http://localhost:3000/api/x402/quote",
      invoiceId: "ora-x402-quote:pi_test",
    });
    const decoded = decodePaymentRequiredHeader(encodePaymentRequiredHeader(body));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0]!.scheme).toBe("exact");
    expect(decoded.accepts[0]!.payTo).toMatch(/^r/);
  });
});

describe("signed FX quote", () => {
  const base: SignedFxQuote = {
    quoteId: "x402_q1",
    pair: "GBP/SGD",
    midRate: "1.7180",
    effectiveRate: "1.71198700",
    fxSpreadBps: 35,
    processingFeeBps: 100,
    amountInMinor: "425000",
    amountInCurrency: "GBP",
    amountOutMinor: "720319",
    amountOutCurrency: "SGD",
    issuedAt: Date.now(),
    validUntil: Date.now() + 60_000,
  };

  it("verifies a freshly signed quote", () => {
    expect(verifyQuote(signQuote(base)).ok).toBe(true);
  });

  it("rejects a tampered amount", () => {
    const env = signQuote(base);
    env.quote.amountOutMinor = "999999";
    const check = verifyQuote(env);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/signature/);
  });

  it("rejects an expired quote", () => {
    const env = signQuote({ ...base, validUntil: Date.now() - 1 });
    expect(verifyQuote(env)).toMatchObject({ ok: false, reason: "quote expired" });
  });

  it("computeQuote applies the spread and 1% fee", () => {
    const q = computeQuote({
      paymentIntentId: "pi_test",
      amountInMinor: "425000",
      amountInCurrency: "GBP",
      amountOutCurrency: "SGD",
      midRate: "1.7180",
      fxSpreadBps: 35,
      processingFeeBps: 100,
    });
    // £4,207.50 convertible × ~1.712 ≈ S$7,200
    expect(Number(q.amountOutMinor)).toBeGreaterThan(715_000);
    expect(Number(q.amountOutMinor)).toBeLessThan(725_000);
    expect(q.effectiveRate.startsWith("1.711")).toBe(true);
  });

  it("regression: prices a 2dp -> 0dp pair correctly instead of assuming both sides are 2dp", () => {
    // GBP (2dp) -> JPY (0dp), no spread/fee for a clean check: 1000.00 GBP
    // at rate 190 should be exactly 190,000 JPY (JPY minor units == major
    // units). A hardcoded /100...*100 conversion — right for GBP/SGD purely
    // because both sides happen to be 2dp — priced this 100x too high.
    const q = computeQuote({
      paymentIntentId: "pi_jpy_test",
      amountInMinor: "100000", // £1,000.00
      amountInCurrency: "GBP",
      amountOutCurrency: "JPY",
      midRate: "190",
      fxSpreadBps: 0,
      processingFeeBps: 0,
    });
    expect(q.amountOutMinor).toBe("190000");
  });

  it("regression: prices a 0dp -> 2dp pair correctly (the mirror case)", () => {
    // JPY (0dp) -> GBP (2dp): ¥190,000 at rate (1/190) should be exactly
    // £1,000.00 = 100,000 minor units. The old formula would have produced
    // 100x too little here.
    const q = computeQuote({
      paymentIntentId: "pi_jpy_test_2",
      amountInMinor: "190000", // ¥190,000 (JPY has no minor-unit distinction)
      amountInCurrency: "JPY",
      amountOutCurrency: "GBP",
      midRate: (1 / 190).toFixed(10),
      fxSpreadBps: 0,
      processingFeeBps: 0,
    });
    expect(q.amountOutMinor).toBe("100000");
  });
});
