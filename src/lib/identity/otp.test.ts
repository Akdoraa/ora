import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { useTestDb, resetTestDb } from "@/test/db";
import { getDb, schema } from "@/db/client";
import {
  requestOtp,
  verifyOtp,
  linkBank,
  normalizePhone,
  InvalidPhoneError,
  OtpVerificationError,
} from "./otp";

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
});

/** requestOtp always falls back to the devCode chip in tests (sendOtpSms
 * short-circuits under NODE_ENV=test) — this just gives that a definite
 * string type instead of sprinkling non-null assertions everywhere below. */
async function requestOtpDev(phone: string) {
  const result = await requestOtp(phone);
  if (result.sent || !result.devCode) throw new Error("expected the devCode fallback in tests");
  return { challengeId: result.challengeId, devCode: result.devCode, expiresAt: result.expiresAt };
}

describe("normalizePhone", () => {
  it("keeps a leading + and strips everything else non-digit", () => {
    expect(normalizePhone(" +44 7700 900123 ")).toBe("+447700900123");
    expect(normalizePhone("(447) 700-900-123")).toBe("447700900123");
  });
});

describe("requestOtp", () => {
  it("rejects an obviously-invalid phone without creating anything", async () => {
    await expect(requestOtp("not a phone")).rejects.toThrow(InvalidPhoneError);
    const db = await getDb();
    expect(await db.select().from(schema.customers)).toHaveLength(0);
  });

  it("creates the customer on first request and returns a demo code", async () => {
    const result = await requestOtpDev("+447700900123");
    expect(result.devCode).toMatch(/^\d{6}$/);
    expect(result.challengeId).toMatch(/^otp_/);

    const db = await getDb();
    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.phone, "+447700900123"));
    expect(customer).toBeDefined();
  });

  it("does not create a second customer row for a repeat request from the same phone", async () => {
    await requestOtpDev("+447700900123");
    await requestOtpDev("+447700900123");
    const db = await getDb();
    const rows = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.phone, "+447700900123"));
    expect(rows).toHaveLength(1);
  });
});

describe("verifyOtp", () => {
  it("succeeds with the right code and reports no saved bank for a new customer", async () => {
    const { challengeId, devCode } = await requestOtpDev("+447700900123");
    const identity = await verifyOtp(challengeId, devCode);
    expect(identity.phone).toBe("+447700900123");
    expect(identity.savedBank).toBeNull();
  });

  it("rejects the wrong code", async () => {
    const { challengeId, devCode } = await requestOtpDev("+447700900123");
    const wrong = devCode === "000000" ? "111111" : "000000";
    await expect(verifyOtp(challengeId, wrong)).rejects.toThrow(OtpVerificationError);
  });

  it("rejects a code that was already used once", async () => {
    const { challengeId, devCode } = await requestOtpDev("+447700900123");
    await verifyOtp(challengeId, devCode);
    await expect(verifyOtp(challengeId, devCode)).rejects.toThrow(/already been used/);
  });

  it("rejects an expired code", async () => {
    const { challengeId, devCode } = await requestOtpDev("+447700900123");
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(6 * 60_000);
      await expect(verifyOtp(challengeId, devCode)).rejects.toThrow(/expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the saved bank for a returning customer", async () => {
    const first = await requestOtpDev("+447700900123");
    const identity1 = await verifyOtp(first.challengeId, first.devCode);
    await linkBank(identity1.customerId, "gb-monzo", "GB");

    const second = await requestOtpDev("+447700900123");
    const identity2 = await verifyOtp(second.challengeId, second.devCode);
    expect(identity2.savedBank).toMatchObject({ bankId: "gb-monzo", bankName: "Monzo" });
    expect(identity2.savedBank!.accountMask).toMatch(/^•+ \d{4}$/);
  });
});

describe("linkBank", () => {
  it("rejects an unknown bank id", async () => {
    const { challengeId, devCode } = await requestOtpDev("+447700900123");
    const identity = await verifyOtp(challengeId, devCode);
    await expect(linkBank(identity.customerId, "not-a-real-bank", "GB")).rejects.toThrow();
  });

  it("replaces the previous link instead of accumulating two active ones", async () => {
    const { challengeId, devCode } = await requestOtpDev("+447700900123");
    const identity = await verifyOtp(challengeId, devCode);
    await linkBank(identity.customerId, "gb-monzo", "GB");
    await linkBank(identity.customerId, "gb-barclays", "GB");

    const db = await getDb();
    const active = await db
      .select()
      .from(schema.customerBankLinks)
      .where(eq(schema.customerBankLinks.status, "active"));
    expect(active).toHaveLength(1);
    expect(active[0]!.bankId).toBe("gb-barclays");
  });
});
