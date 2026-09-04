import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { createMerchant, createApiKey, createPaymentIntent } from "@/test/fixtures";
import { currentMerchantId } from "@/lib/dashboard";

const processRefund = vi.fn();
vi.mock("@/lib/refunds/refund", () => ({
  processRefund: (...args: unknown[]) => processRefund(...args),
}));

const { POST } = await import("./route");

function req(id: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return new NextRequest(`http://localhost/api/payment-intents/${id}/refund`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  processRefund.mockReset();
  processRefund.mockResolvedValue({
    refundId: "rfnd_test",
    status: "succeeded",
    amount: { amount: 100n, currency: "GBP" },
  });
});

describe("POST /api/payment-intents/:id/refund", () => {
  it("404s for an unknown intent", async () => {
    const res = await POST(req("pi_nope"), ctx("pi_nope"));
    expect(res.status).toBe(404);
    expect(processRefund).not.toHaveBeenCalled();
  });

  it("regression: an unauthenticated caller cannot refund a DIFFERENT merchant's payment", async () => {
    // the demo merchant (currentMerchantId()) always exists via seeding in
    // production, but the attacker's target here is an unrelated merchant
    const otherMerchant = await createMerchant({ id: "mrc_someone_else" });
    const { id } = await createPaymentIntent({ merchantId: otherMerchant, status: "paid" });

    const res = await POST(req(id), ctx(id));

    expect(res.status).toBe(401);
    expect(processRefund).not.toHaveBeenCalled();
  });

  it("regression: a caller with an INVALID API key cannot refund a different merchant's payment either", async () => {
    const otherMerchant = await createMerchant({ id: "mrc_someone_else" });
    const { id } = await createPaymentIntent({ merchantId: otherMerchant, status: "paid" });

    const res = await POST(req(id, { token: "ora_sk_test_totally_bogus" }), ctx(id));

    expect(res.status).toBe(401);
    expect(processRefund).not.toHaveBeenCalled();
  });

  it("allows an unauthenticated same-origin call for the demo merchant's own payment (dashboard flow)", async () => {
    await createMerchant({ id: currentMerchantId() });
    const { id } = await createPaymentIntent({ merchantId: currentMerchantId(), status: "paid" });

    const res = await POST(req(id), ctx(id));

    expect(res.status).toBe(200);
    expect(processRefund).toHaveBeenCalledTimes(1);
  });

  it("rejects a valid API key attempting to refund a DIFFERENT merchant's payment", async () => {
    const merchantA = await createMerchant({ id: "mrc_a" });
    const merchantB = await createMerchant({ id: "mrc_b" });
    const { token } = await createApiKey({ merchantId: merchantA });
    const { id } = await createPaymentIntent({ merchantId: merchantB, status: "paid" });

    const res = await POST(req(id, { token }), ctx(id));

    expect(res.status).toBe(403);
    expect(processRefund).not.toHaveBeenCalled();
  });

  it("allows a valid API key to refund its own merchant's payment", async () => {
    const merchantA = await createMerchant({ id: "mrc_a" });
    const { token } = await createApiKey({ merchantId: merchantA });
    const { id } = await createPaymentIntent({ merchantId: merchantA, status: "paid" });

    const res = await POST(req(id, { token, body: { reason: "customer request" } }), ctx(id));

    expect(res.status).toBe(200);
    expect(processRefund).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: id, reason: "customer request" }),
    );
  });

  it("maps a processRefund failure to a 409", async () => {
    processRefund.mockRejectedValueOnce(new Error("cannot refund an intent in status created"));
    await createMerchant({ id: currentMerchantId() });
    const { id } = await createPaymentIntent({ merchantId: currentMerchantId(), status: "created" });

    const res = await POST(req(id), ctx(id));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("refund_failed");
  });
});
