import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { POST } from "./route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/checkout/identify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
});

describe("POST /api/checkout/identify", () => {
  it("issues a challenge with a demo code", async () => {
    const res = await POST(req({ phone: "+447700900123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challengeId).toBeDefined();
    expect(body.devCode).toMatch(/^\d{6}$/);
  });

  it("422s a phone that's the right length but not actually digits", async () => {
    const res = await POST(req({ phone: "abcdefgh" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid_phone");
  });

  it("422s a too-short body field", async () => {
    const res = await POST(req({ phone: "123" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("validation_error");
  });
});
