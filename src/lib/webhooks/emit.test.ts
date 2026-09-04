import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { useTestDb, resetTestDb } from "@/test/db";
import { createPaymentIntent } from "@/test/fixtures";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { verifyWebhook } from "./sign";
import { emitWebhook, replayDelivery } from "./emit";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function okResponse(body = "ok") {
  return { ok: true, status: 200, text: async () => body } as Response;
}
function failResponse(status = 500, body = "server error") {
  return { ok: false, status, text: async () => body } as Response;
}

async function createEndpoint(
  merchantId: string,
  overrides: Partial<typeof schema.webhookEndpoints.$inferInsert> = {},
) {
  const db = await getDb();
  const id = newId("whe");
  await db.insert(schema.webhookEndpoints).values({
    id,
    merchantId,
    url: "https://merchant.example/webhooks/ora",
    secret: "whsec_test",
    enabledEvents: ["*"],
    active: true,
    scope: "merchant",
    ...overrides,
  });
  return id;
}

async function deliveriesFor(intentId: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.paymentIntentId, intentId));
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okResponse());
});

describe("emitWebhook", () => {
  it("delivers to an active merchant-scoped endpoint, correctly signed", async () => {
    const { id: intentId, merchantId } = await createPaymentIntent();
    await createEndpoint(merchantId);

    await emitWebhook(intentId, "payment.paid", { foo: "bar" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://merchant.example/webhooks/ora");
    const headers = init.headers as Record<string, string>;
    expect(headers["ora-signature"]).toBeDefined();
    const check = verifyWebhook("whsec_test", init.body as string, headers["ora-signature"]!);
    expect(check.ok).toBe(true);

    const rows = await deliveriesFor(intentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("delivered");
    expect(rows[0]!.deliveredAt).not.toBeNull();
  });

  it("does not deliver to a paused endpoint", async () => {
    const { id: intentId, merchantId } = await createPaymentIntent();
    await createEndpoint(merchantId, { active: false });

    await emitWebhook(intentId, "payment.paid", {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveriesFor(intentId)).toHaveLength(0);
  });

  it("an ad-hoc per-intent webhookUrl fires and is persisted as scope: intent", async () => {
    const { id: intentId } = await createPaymentIntent({
      webhookUrl: "https://agent.example/callback",
    });

    await emitWebhook(intentId, "payment.paid", {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://agent.example/callback");

    const db = await getDb();
    const [endpoint] = await db
      .select()
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.id, `whe_intent_${intentId}`))
      .limit(1);
    expect(endpoint).toBeDefined();
    expect(endpoint!.scope).toBe("intent");
  });

  it("regression: a scope:intent endpoint created for one intent never fires for a different intent on the same merchant", async () => {
    const { id: intentA, merchantId } = await createPaymentIntent({
      webhookUrl: "https://agent.example/intent-a-callback",
    });
    await emitWebhook(intentA, "payment.paid", {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();

    // a second, unrelated intent on the *same* merchant, with no webhookUrl
    // of its own and no standing merchant-scoped subscription
    const { id: intentB } = await createPaymentIntent({ merchantId });
    await emitWebhook(intentB, "payment.paid", {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveriesFor(intentB)).toHaveLength(0);

    // sanity: the scope:intent row from intent A really is scoped "intent",
    // not the default "merchant" that would have made it a standing subscriber
    const db = await getDb();
    const [row] = await db
      .select()
      .from(schema.webhookEndpoints)
      .where(
        and(
          eq(schema.webhookEndpoints.merchantId, merchantId),
          eq(schema.webhookEndpoints.scope, "intent"),
        ),
      );
    expect(row).toBeDefined();
  });

  it("marks a delivery retrying on failure, then failed after repeated retries", async () => {
    const { id: intentId, merchantId } = await createPaymentIntent();
    await createEndpoint(merchantId);
    fetchMock.mockResolvedValue(failResponse(503));

    await emitWebhook(intentId, "payment.paid", {});
    let [row] = await deliveriesFor(intentId);
    expect(row!.status).toBe("retrying");
    expect(row!.attempts).toBe(1);
    expect(row!.nextAttemptAt).not.toBeNull();

    // drive it through the remaining attempts via manual replay, as the
    // dashboard's "replay" action (and a real retry worker) would
    for (let i = 0; i < 3; i++) {
      await replayDelivery(row!.id);
      [row] = await deliveriesFor(intentId);
    }
    expect(row!.status).toBe("retrying");
    expect(row!.attempts).toBe(4);

    await replayDelivery(row!.id);
    [row] = await deliveriesFor(intentId);
    expect(row!.status).toBe("failed");
    expect(row!.attempts).toBe(5);
  });

  it("replayDelivery succeeds and stamps deliveredAt once the endpoint recovers", async () => {
    const { id: intentId, merchantId } = await createPaymentIntent();
    await createEndpoint(merchantId);
    fetchMock.mockResolvedValueOnce(failResponse(500));

    await emitWebhook(intentId, "payment.paid", {});
    let [row] = await deliveriesFor(intentId);
    expect(row!.status).toBe("retrying");

    fetchMock.mockResolvedValueOnce(okResponse());
    await replayDelivery(row!.id);
    [row] = await deliveriesFor(intentId);
    expect(row!.status).toBe("delivered");
    expect(row!.deliveredAt).not.toBeNull();
    expect(row!.attempts).toBe(2);
  });

  it("is a no-op when the intent has no subscribers at all", async () => {
    const { id: intentId } = await createPaymentIntent();
    await emitWebhook(intentId, "payment.paid", {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveriesFor(intentId)).toHaveLength(0);
  });
});
