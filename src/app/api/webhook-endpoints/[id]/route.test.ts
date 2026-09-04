import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { createMerchant } from "@/test/fixtures";
import { getDb, schema } from "@/db/client";
import { currentMerchantId } from "@/lib/dashboard";
import { newId } from "@/lib/ids";
import { PATCH } from "./route";

function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/webhook-endpoints/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createEndpoint(overrides: Partial<typeof schema.webhookEndpoints.$inferInsert> = {}) {
  const db = await getDb();
  const id = overrides.id ?? newId("whe");
  await db.insert(schema.webhookEndpoints).values({
    id,
    merchantId: currentMerchantId(),
    url: "https://merchant.example/webhooks/ora",
    secret: "whsec_test",
    enabledEvents: ["*"],
    active: true,
    scope: "merchant",
    ...overrides,
  });
  return id;
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  await createMerchant({ id: currentMerchantId() });
});

describe("PATCH /api/webhook-endpoints/:id", () => {
  it("pauses an endpoint and never returns the secret", async () => {
    const id = await createEndpoint({ active: true });
    const res = await PATCH(patchReq({ active: false }), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(false);
    expect(body.secret).toBeUndefined();
  });

  it("404s for an unknown id", async () => {
    const res = await PATCH(patchReq({ active: false }), ctx("whe_nope"));
    expect(res.status).toBe(404);
  });

  it("404s for an endpoint belonging to a different merchant (scoped lookup)", async () => {
    const id = await createEndpoint({ merchantId: await createMerchant({ id: "mrc_other" }) });
    const res = await PATCH(patchReq({ active: false }), ctx(id));
    expect(res.status).toBe(404);
  });

  it("422s when the body has no recognised fields", async () => {
    const id = await createEndpoint();
    const res = await PATCH(patchReq({ notAField: 1 }), ctx(id));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("no_changes");
  });

  it("rejects a malformed url", async () => {
    const id = await createEndpoint();
    const res = await PATCH(patchReq({ url: "not-a-url" }), ctx(id));
    expect(res.status).toBe(422);
  });
});
