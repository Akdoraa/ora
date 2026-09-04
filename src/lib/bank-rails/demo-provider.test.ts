import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTestDb, resetTestDb } from "@/test/db";
import { createPaymentIntent } from "@/test/fixtures";
import { DemoBankProvider } from "./demo-provider";

let provider: DemoBankProvider;
let intentId: string;

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  provider = new DemoBankProvider();
  intentId = (await createPaymentIntent()).id;
});

describe("DemoBankProvider", () => {
  it("lists banks per country, falling back to GB", async () => {
    expect((await provider.listBanks("SG")).map((b) => b.id)).toContain("sg-dbs");
    expect((await provider.listBanks("GB")).map((b) => b.id)).toContain("gb-monzo");
    expect((await provider.listBanks("ZZ")).map((b) => b.id)).toContain("gb-monzo");
  });

  it("creates a pending authorization with a masked account, never raw credentials", async () => {
    const auth = await provider.createAuthorization({
      paymentIntentId: intentId,
      amountMinor: 425_000n,
      currency: "GBP",
      method: "bank",
    });
    expect(auth.status).toBe("pending");
    expect(auth.accountMask).toMatch(/^•+ \d{4}$/);
    expect(auth.qrPayload).toBeNull();
    expect(auth.amount).toBe(425_000n);
  });

  it("QR method generates a scannable payload", async () => {
    const auth = await provider.createAuthorization({
      paymentIntentId: intentId,
      amountMinor: 1_000n,
      currency: "GBP",
      method: "qr",
    });
    expect(auth.qrPayload).toMatch(/^ora:\/\/pay\?/);
  });

  it("the happy path: pending -> confirmed", async () => {
    const created = await provider.createAuthorization({
      paymentIntentId: intentId,
      amountMinor: 100n,
      currency: "GBP",
      method: "bank",
    });
    const confirmed = await provider.confirmAuthorization(created.id, "confirm");
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedAt).not.toBeNull();
  });

  it("simulates a declined authorization with a human-readable reason", async () => {
    const created = await provider.createAuthorization({
      paymentIntentId: intentId,
      amountMinor: 100n,
      currency: "GBP",
      method: "bank",
    });
    const failed = await provider.confirmAuthorization(created.id, "fail");
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toMatch(/declined/i);
  });

  it("simulates an expired authorization", async () => {
    const created = await provider.createAuthorization({
      paymentIntentId: intentId,
      amountMinor: 100n,
      currency: "GBP",
      method: "bank",
    });
    const expired = await provider.confirmAuthorization(created.id, "expire");
    expect(expired.status).toBe("expired");
  });

  it("an authorization past its TTL expires even if 'confirm' is requested", async () => {
    const created = await provider.createAuthorization({
      paymentIntentId: intentId,
      amountMinor: 100n,
      currency: "GBP",
      method: "bank",
    });
    expect(created.expiresAt!.getTime()).toBeGreaterThan(Date.now());

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(created.expiresAt!.getTime() + 1_000));
      // the payer clicks "confirm" after the window closed — the provider
      // must not honour it as a confirmation
      const result = await provider.confirmAuthorization(created.id, "confirm");
      expect(result.status).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent: confirming an already-resolved authorization doesn't flip it again", async () => {
    const created = await provider.createAuthorization({
      paymentIntentId: intentId,
      amountMinor: 100n,
      currency: "GBP",
      method: "bank",
    });
    const first = await provider.confirmAuthorization(created.id, "confirm");
    const second = await provider.confirmAuthorization(created.id, "fail");
    // second call is a no-op because status is no longer "pending"
    expect(second.status).toBe(first.status);
    expect(second.status).toBe("confirmed");
  });

  it("cancelAuthorization moves a pending authorization to cancelled", async () => {
    const created = await provider.createAuthorization({
      paymentIntentId: intentId,
      amountMinor: 100n,
      currency: "GBP",
      method: "bank",
    });
    const cancelled = await provider.cancelAuthorization(created.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("getAuthorization returns null for an unknown id", async () => {
    expect(await provider.getAuthorization("ba_does_not_exist")).toBeNull();
  });
});
