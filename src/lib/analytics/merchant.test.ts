import { describe, it, expect, beforeEach } from "vitest";
import { useTestDb, resetTestDb } from "@/test/db";
import { createMerchant, createPaymentIntent } from "@/test/fixtures";
import { merchantOverview } from "./merchant";

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
});

describe("merchantOverview", () => {
  it("returns null for an unknown merchant", async () => {
    expect(await merchantOverview("mrc_nope")).toBeNull();
  });

  it("regression: totalVolumeMinor is denominated in volumeCurrency, not the presentment currency", async () => {
    // presentment GBP, settlement SGD — the classic demo shape. Volume must
    // be reported in the merchant's own settlement currency (what they
    // actually received), matching the volumeCurrency label already
    // returned, not the payer's presentment currency.
    const merchantId = await createMerchant({ settlementCurrency: "SGD" });
    await createPaymentIntent({
      merchantId,
      status: "delivered",
      amount: 425_000n, // £4,250.00 presentment
      currency: "GBP",
      settlementAmount: 720_319n, // S$7,203.19 actually delivered
      settlementCurrency: "SGD",
    });

    const ov = await merchantOverview(merchantId);
    expect(ov!.volumeCurrency).toBe("SGD");
    // must be the settlement amount (720319), never the presentment
    // amount (425000) mislabelled as SGD
    expect(ov!.totalVolumeMinor).toBe("720319");
  });

  it("sums settlement amounts across multiple paid intents", async () => {
    const merchantId = await createMerchant({ settlementCurrency: "SGD" });
    await createPaymentIntent({
      merchantId,
      status: "paid",
      settlementAmount: 100_00n,
      settlementCurrency: "SGD",
    });
    await createPaymentIntent({
      merchantId,
      status: "delivered",
      settlementAmount: 250_00n,
      settlementCurrency: "SGD",
    });
    const ov = await merchantOverview(merchantId);
    expect(ov!.totalVolumeMinor).toBe("35000");
  });

  it("excludes unpaid/failed intents from volume", async () => {
    const merchantId = await createMerchant({ settlementCurrency: "SGD" });
    await createPaymentIntent({ merchantId, status: "created", settlementAmount: 999_00n });
    await createPaymentIntent({ merchantId, status: "payment_failed", settlementAmount: 999_00n });
    const ov = await merchantOverview(merchantId);
    expect(ov!.totalVolumeMinor).toBe("0");
    expect(ov!.paidCount).toBe(0);
    expect(ov!.failedCount).toBe(1);
  });

  it("treats a paid intent with no settlementAmount yet as zero, not a crash", async () => {
    const merchantId = await createMerchant({ settlementCurrency: "SGD" });
    await createPaymentIntent({ merchantId, status: "paid", settlementAmount: undefined });
    const ov = await merchantOverview(merchantId);
    expect(ov!.totalVolumeMinor).toBe("0");
  });

  it("100% success rate when there are no paid or failed intents yet", async () => {
    const merchantId = await createMerchant();
    await createPaymentIntent({ merchantId, status: "created" });
    const ov = await merchantOverview(merchantId);
    expect(ov!.successRatePct).toBe(100);
  });
});
