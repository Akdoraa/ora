import { describe, it, expect } from "vitest";
import { signWebhook, verifyWebhook } from "./sign";

const SECRET = "whsec_test_0123456789abcdef";

describe("webhook signatures", () => {
  it("round-trips a valid signature", () => {
    const body = JSON.stringify({ id: "evt_1", type: "payment.settled" });
    const header = signWebhook(SECRET, body);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhook(SECRET, body, header).ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const header = signWebhook(SECRET, '{"amount":100}');
    const check = verifyWebhook(SECRET, '{"amount":999}', header);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/mismatch/);
  });

  it("rejects the wrong secret", () => {
    const body = "{}";
    const header = signWebhook(SECRET, body);
    expect(verifyWebhook("whsec_other_key_9999", body, header).ok).toBe(false);
  });

  it("rejects a stale timestamp", () => {
    const body = "{}";
    const header = signWebhook(SECRET, body, Math.floor(Date.now() / 1000) - 4000);
    const check = verifyWebhook(SECRET, body, header);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/tolerance/);
  });

  it("rejects a malformed header", () => {
    expect(verifyWebhook(SECRET, "{}", "garbage").ok).toBe(false);
  });
});
