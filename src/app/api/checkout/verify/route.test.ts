import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { requestOtp } from "@/lib/identity/otp";
import { POST } from "./route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/checkout/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
});

describe("POST /api/checkout/verify", () => {
  it("verifies the right code and reports no saved bank for a new customer", async () => {
    const { challengeId, devCode } = await requestOtp("+447700900123");
    const res = await POST(req({ challengeId, code: devCode }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.phone).toBe("+447700900123");
    expect(body.savedBank).toBeNull();
  });

  it("401s the wrong code", async () => {
    const { challengeId, devCode } = await requestOtp("+447700900123");
    const wrong = devCode === "000000" ? "111111" : "000000";
    const res = await POST(req({ challengeId, code: wrong }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("otp_invalid");
  });

  it("401s an unknown challenge id", async () => {
    const res = await POST(req({ challengeId: "otp_nope", code: "123456" }));
    expect(res.status).toBe(401);
  });
});
