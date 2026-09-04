import { describe, it, expect, beforeEach } from "vitest";
import { useTestDb, resetTestDb } from "@/test/db";
import { createPaymentIntent } from "@/test/fixtures";
import { money } from "@/lib/money/money";
import {
  postTransaction,
  balanceOf,
  trialBalance,
  UnbalancedLedgerError,
  captureEntries,
  feeEntries,
  fxAndPayableEntries,
  payoutEntries,
  refundEntries,
} from "./ledger";

let PI = "";
let MRC = "";

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  const created = await createPaymentIntent();
  PI = created.id;
  MRC = created.merchantId;
});

describe("postTransaction", () => {
  it("rejects an unbalanced transaction", async () => {
    await expect(
      postTransaction({
        kind: "test",
        reason: "unbalanced",
        entries: [
          { account: { type: "funds_pending", currency: "GBP" }, amount: 100n, currency: "GBP" },
          { account: { type: "external_world", currency: "GBP" }, amount: -90n, currency: "GBP" },
        ],
      }),
    ).rejects.toBeInstanceOf(UnbalancedLedgerError);
  });

  it("accepts a balanced transaction and derives balances from entries", async () => {
    await postTransaction({
      kind: "capture",
      reason: "bank funds landed",
      paymentIntentId: PI,
      entries: captureEntries(money(425_000n, "GBP"), PI),
    });
    expect(await balanceOf({ type: "external_world", currency: "GBP" })).toBe(-425_000n);
    expect(
      await balanceOf({ type: "funds_pending", scopeId: PI, currency: "GBP" }),
    ).toBe(425_000n);
  });

  it("is idempotent on idempotencyKey", async () => {
    const input = {
      kind: "capture",
      reason: "x",
      paymentIntentId: PI,
      idempotencyKey: "cap-1",
      entries: captureEntries(money(1000n, "GBP"), PI),
    };
    const a = await postTransaction(input);
    const b = await postTransaction(input);
    expect(b.reused).toBe(true);
    expect(b.ledgerTransactionId).toBe(a.ledgerTransactionId);
    expect(await balanceOf({ type: "funds_pending", scopeId: PI, currency: "GBP" })).toBe(
      1000n,
    );
  });
});

describe("full payment lifecycle keeps the books balanced", () => {
  // £4,250.00 gross, 1% fee = £42.50, liquidity share £4,207.50
  // FX at locked 1.7120; spread revenue £14.72 (GBP), merchant net S$7,193.24
  const gross = money(425_000n, "GBP");
  const fee = money(4_250n, "GBP");
  const liquidityShare = money(420_750n, "GBP");
  const fxSpread = money(1_472n, "GBP");
  const merchantNet = money(719_324n, "SGD");

  it("capture -> fee -> fx/payable -> payout nets to zero per currency", async () => {
    await postTransaction({
      kind: "capture",
      reason: "capture",
      paymentIntentId: PI,
      entries: captureEntries(gross, PI),
    });
    await postTransaction({
      kind: "fee",
      reason: "1% processing fee",
      paymentIntentId: PI,
      entries: feeEntries(fee, PI),
    });
    await postTransaction({
      kind: "fx",
      reason: "route locked, fx + payable",
      paymentIntentId: PI,
      entries: fxAndPayableEntries({
        paymentIntentId: PI,
        merchantId: MRC,
        liquidityShare,
        fxSpreadRevenue: fxSpread,
        merchantNet,
      }),
    });
    await postTransaction({
      kind: "settle",
      reason: "xrpl settlement confirmed",
      paymentIntentId: PI,
      entries: payoutEntries({ merchantId: MRC, merchantNet }),
    });

    const tb = await trialBalance();
    expect(tb.GBP ?? 0n).toBe(0n);
    expect(tb.SGD ?? 0n).toBe(0n);

    expect(await balanceOf({ type: "processing_fee_revenue", currency: "GBP" })).toBe(
      4_250n,
    );
    expect(await balanceOf({ type: "fx_spread_revenue", currency: "GBP" })).toBe(1_472n);
    expect(await balanceOf({ type: "merchant_payable", scopeId: MRC, currency: "SGD" })).toBe(
      0n,
    );
    // Ora paid the merchant: value left to the external world
    expect(await balanceOf({ type: "external_world", currency: "SGD" })).toBe(719_324n);
    // funds_pending fully drained
    expect(
      await balanceOf({ type: "funds_pending", scopeId: PI, currency: "GBP" }),
    ).toBe(0n);
  });

  it("a full refund reverses revenue and returns gross to the customer", async () => {
    for (const t of [
      { kind: "capture", entries: captureEntries(gross, PI) },
      { kind: "fee", entries: feeEntries(fee, PI) },
      {
        kind: "fx",
        entries: fxAndPayableEntries({
          paymentIntentId: PI,
          merchantId: MRC,
          liquidityShare,
          fxSpreadRevenue: fxSpread,
          merchantNet,
        }),
      },
      { kind: "settle", entries: payoutEntries({ merchantId: MRC, merchantNet }) },
    ]) {
      await postTransaction({ kind: t.kind, reason: t.kind, paymentIntentId: PI, entries: t.entries });
    }

    await postTransaction({
      kind: "refund",
      reason: "full refund",
      paymentIntentId: PI,
      entries: refundEntries({
        merchantId: MRC,
        grossToCustomer: gross,
        processingFee: fee,
        fxSpread,
        merchantNet,
      }),
    });

    const tb = await trialBalance();
    expect(tb.GBP ?? 0n).toBe(0n);
    expect(tb.SGD ?? 0n).toBe(0n);
    expect(await balanceOf({ type: "processing_fee_revenue", currency: "GBP" })).toBe(0n);
    expect(await balanceOf({ type: "fx_spread_revenue", currency: "GBP" })).toBe(0n);
    // customer made whole: net external world GBP is 0 (paid 425000 in, got 425000 back)
    expect(await balanceOf({ type: "external_world", currency: "GBP" })).toBe(0n);
  });
});
