import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { createMerchant } from "@/test/fixtures";
import { getDb, schema } from "@/db/client";
import { currentMerchantId } from "@/lib/dashboard";
import { GET, POST } from "./route";

function postReq(body: unknown) {
  return new NextRequest("http://localhost/api/webhook-endpoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  await createMerchant({ id: currentMerchantId() });
});

describe("POST /api/webhook-endpoints", () => {
  it("creates an endpoint, scoped to the merchant, and returns the secret once", async () => {
    const res = await POST(postReq({ url: "https://merchant.example/webhooks/ora" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toBe("https://merchant.example/webhooks/ora");
    expect(body.scope).toBe("merchant");
    expect(body.secret).toMatch(/^whsec_/);

    const db = await getDb();
    const [row] = await db
      .select()
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.id, body.id));
    expect(row!.merchantId).toBe(currentMerchantId());
  });

  it("rejects a non-https, non-localhost URL", async () => {
    const res = await POST(postReq({ url: "http://not-secure.example/hook" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid_url");
  });

  it("allows localhost over http for local dev/demo", async () => {
    const res = await POST(postReq({ url: "http://localhost:3000/webhooks/ora" }));
    expect(res.status).toBe(201);
  });

  it("rejects a malformed URL", async () => {
    const res = await POST(postReq({ url: "not-a-url" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("validation_error");
  });
});

describe("GET /api/webhook-endpoints", () => {
  it("lists merchant-scoped endpoints without leaking the secret", async () => {
    await POST(postReq({ url: "https://merchant.example/webhooks/ora" }));
    const res = await GET();
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].secret).toBeUndefined();
  });

  it("never lists a scope: intent endpoint (one-off, not a standing subscription)", async () => {
    const db = await getDb();
    await db.insert(schema.webhookEndpoints).values({
      id: "whe_intent_pi_whatever",
      merchantId: currentMerchantId(),
      url: "https://agent.example/one-off-callback",
      secret: "whsec_irrelevant",
      enabledEvents: ["*"],
      active: true,
      scope: "intent",
    });
    const res = await GET();
    const rows = await res.json();
    expect(rows).toHaveLength(0);
  });
});
