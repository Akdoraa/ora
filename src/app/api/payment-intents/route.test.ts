import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { createMerchant, createApiKey } from "@/test/fixtures";
import { POST } from "./route";

function postReq(body: unknown, opts: { token?: string; idempotencyKey?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new NextRequest("http://localhost/api/payment-intents", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  amount: 100_000,
  currency: "GBP",
  settlementCurrency: "SGD",
  description: "Annual software plan",
};

let token: string;

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  const merchantId = await createMerchant();
  ({ token } = await createApiKey({ merchantId }));
});

describe("POST /api/payment-intents", () => {
  it("creates an intent and returns the hosted checkout, manifest and status URLs", async () => {
    const res = await POST(postReq(VALID_BODY, { token }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.object).toBe("payment_intent");
    expect(body.status).toBe("created");
    expect(body.checkoutUrl).toContain(`/checkout/${body.id}`);
    expect(body.manifestUrl).toContain(`/api/payment-intents/${body.id}/manifest`);
    expect(body.statusUrl).toContain(`/api/payment-intents/${body.id}/status`);
  });

  it("401s without an API key", async () => {
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("401s with a bogus API key", async () => {
    const res = await POST(postReq(VALID_BODY, { token: "ora_sk_test_not_a_real_key" }));
    expect(res.status).toBe(401);
  });

  it("422s for an unsupported currency", async () => {
    const res = await POST(postReq({ ...VALID_BODY, currency: "ZZZ" }, { token }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("unsupported_currency");
  });

  it("normalizes a lower-case currency to upper-case before storing", async () => {
    const res = await POST(postReq({ ...VALID_BODY, currency: "gbp" }, { token }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.currency).toBe("GBP");
  });

  it("422s a validation error (non-positive amount)", async () => {
    const res = await POST(postReq({ ...VALID_BODY, amount: 0 }, { token }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("validation_error");
  });

  it("422s missing description", async () => {
    const { description: _description, ...rest } = VALID_BODY;
    const res = await POST(postReq(rest, { token }));
    expect(res.status).toBe(422);
  });

  it("is idempotent: the same key + same body replays the original 201", async () => {
    const first = await POST(postReq(VALID_BODY, { token, idempotencyKey: "create-once" }));
    const firstBody = await first.json();

    const second = await POST(postReq(VALID_BODY, { token, idempotencyKey: "create-once" }));
    expect(second.status).toBe(201);
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);
  });

  it("rejects the same idempotency key reused with a different body", async () => {
    await POST(postReq(VALID_BODY, { token, idempotencyKey: "reuse-key" }));
    const second = await POST(
      postReq({ ...VALID_BODY, amount: 999 }, { token, idempotencyKey: "reuse-key" }),
    );
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error).toBe("idempotency_conflict");
  });
});
