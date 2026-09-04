import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { createMerchant } from "@/test/fixtures";
import { getDb, schema } from "@/db/client";
import { currentMerchantId } from "@/lib/dashboard";
import { newId } from "@/lib/ids";

const replayDelivery = vi.fn();
vi.mock("@/lib/webhooks/emit", () => ({
  replayDelivery: (...args: unknown[]) => replayDelivery(...args),
}));

const { POST } = await import("./route");

function req() {
  return new NextRequest("http://localhost/api/webhooks/deliveries/x/replay", { method: "POST" });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedEndpointAndDelivery(merchantId: string) {
  const db = await getDb();
  const endpointId = newId("whe");
  await db.insert(schema.webhookEndpoints).values({
    id: endpointId,
    merchantId,
    url: "https://merchant.example/webhooks/ora",
    secret: "whsec_test",
    enabledEvents: ["*"],
    active: true,
    scope: "merchant",
  });
  const deliveryId = newId("whd");
  await db.insert(schema.webhookDeliveries).values({
    id: deliveryId,
    endpointId,
    eventType: "payment.paid",
    eventId: newId("evt"),
    payload: { hello: "world" },
    signature: "t=1,v1=deadbeef",
    status: "failed",
  });
  return deliveryId;
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  replayDelivery.mockReset();
  await createMerchant({ id: currentMerchantId() });
});

describe("POST /api/webhooks/deliveries/:id/replay", () => {
  it("404s for an unknown delivery", async () => {
    const res = await POST(req(), ctx("whd_nope"));
    expect(res.status).toBe(404);
    expect(replayDelivery).not.toHaveBeenCalled();
  });

  it("replays a delivery belonging to the dashboard's own merchant", async () => {
    const deliveryId = await seedEndpointAndDelivery(currentMerchantId());
    const res = await POST(req(), ctx(deliveryId));
    expect(res.status).toBe(200);
    expect(replayDelivery).toHaveBeenCalledWith(deliveryId);
  });

  it("regression: 404s (does not replay) a delivery belonging to a DIFFERENT merchant", async () => {
    const otherMerchant = await createMerchant({ id: "mrc_someone_else" });
    const deliveryId = await seedEndpointAndDelivery(otherMerchant);
    const res = await POST(req(), ctx(deliveryId));
    expect(res.status).toBe(404);
    expect(replayDelivery).not.toHaveBeenCalled();
  });
});
