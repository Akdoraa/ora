import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { createMerchant } from "@/test/fixtures";
import { getDb, schema } from "@/db/client";
import { currentMerchantId } from "@/lib/dashboard";
import { POST } from "./route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/payment-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  amountMajor: 42.5,
  currency: "GBP",
  settlementCurrency: "SGD",
  description: "Annual software plan",
};

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  await createMerchant({ id: currentMerchantId() });
});

describe("POST /api/payment-links", () => {
  it("creates a link and returns hosted checkout + manifest URLs", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.checkoutUrl).toContain(`/checkout/${body.id}`);
    expect(body.manifestUrl).toContain(`/api/payment-intents/${body.id}/manifest`);
  });

  it("converts a 2dp major amount to minor units precisely (regression: was float *100)", async () => {
    // 0.145 * 100 with plain floats rounds down to 14 (IEEE 754), not the
    // correct 15 — moneyFromDecimal (Decimal-based) must not repeat that
    const res = await POST(req({ ...VALID, amountMajor: 42.5 }));
    const body = await res.json();
    const db = await getDb();
    const [intent] = await db
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.id, body.id));
    expect(intent!.amount).toBe(4250n);
  });

  it("regression: correctly scales a zero-decimal currency instead of always assuming 2dp", async () => {
    // JPY has exponent 0 — a hardcoded *100 would have stored 150000 instead of 1500
    const res = await POST(req({ ...VALID, currency: "JPY", settlementCurrency: "JPY", amountMajor: 1500 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    const db = await getDb();
    const [intent] = await db
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.id, body.id));
    expect(intent!.amount).toBe(1500n);
  });

  it("422s for an unsupported currency", async () => {
    const res = await POST(req({ ...VALID, currency: "ZZZ" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("unsupported_currency");
  });

  it("422s a non-positive amount", async () => {
    const res = await POST(req({ ...VALID, amountMajor: 0 }));
    expect(res.status).toBe(422);
  });

  it("always scopes the link to the dashboard's own demo merchant", async () => {
    const res = await POST(req(VALID));
    const body = await res.json();
    const db = await getDb();
    const [intent] = await db
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.id, body.id));
    expect(intent!.merchantId).toBe(currentMerchantId());
  });
});
