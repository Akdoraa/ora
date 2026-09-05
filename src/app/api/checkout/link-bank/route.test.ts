import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { requestOtp, verifyOtp } from "@/lib/identity/otp";
import { POST } from "./route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/checkout/link-bank", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
});

async function identify() {
  // devCode is always populated in tests — sendOtpSms short-circuits under
  // NODE_ENV=test (see src/lib/identity/sms.ts), so a real text is never
  // attempted and `sent` is always false here.
  const { challengeId, devCode } = await requestOtp("+447700900123");
  return verifyOtp(challengeId, devCode!);
}

describe("POST /api/checkout/link-bank", () => {
  it("links a bank and returns the masked account", async () => {
    const identity = await identify();
    const res = await POST(req({ customerId: identity.customerId, bankId: "gb-monzo", country: "GB" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bankName).toBe("Monzo");
    expect(body.accountMask).toMatch(/^•+ \d{4}$/);
  });

  it("defaults to GB when no country is given", async () => {
    const identity = await identify();
    const res = await POST(req({ customerId: identity.customerId, bankId: "gb-barclays" }));
    expect(res.status).toBe(200);
  });

  it("422s an unknown bank id", async () => {
    const identity = await identify();
    const res = await POST(req({ customerId: identity.customerId, bankId: "not-a-bank" }));
    expect(res.status).toBe(422);
  });
});
