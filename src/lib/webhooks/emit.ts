import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { env } from "@/env";
import { signWebhook } from "./sign";
import { getIntent } from "@/lib/payment-intents/service";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [0, 5_000, 30_000, 120_000, 600_000];

export interface WebhookEvent {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

async function endpointsFor(intentId: string): Promise<
  { id: string; url: string; secret: string }[]
> {
  const db = await getDb();
  const intent = await getIntent(intentId);
  if (!intent) return [];
  // Only real, standing subscriptions fire for every intent. A past intent's
  // one-off `scope: "intent"` endpoint must never fan out to *this* intent.
  const configured = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(
      and(
        eq(schema.webhookEndpoints.merchantId, intent.merchantId),
        eq(schema.webhookEndpoints.scope, "merchant"),
      ),
    );

  const list = configured
    .filter((e) => e.active)
    .map((e) => ({ id: e.id, url: e.url, secret: e.secret }));

  // per-intent ad-hoc webhook URL (from the Payment Intent API)
  if (intent.webhookUrl) {
    list.push({
      id: `whe_intent_${intentId}`,
      url: intent.webhookUrl,
      secret: env.WEBHOOK_SIGNING_SECRET,
    });
  }
  return list;
}

async function attemptDelivery(deliveryId: string): Promise<void> {
  const db = await getDb();
  const [d] = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!d || d.status === "delivered") return;

  const endpoint = (
    await db
      .select()
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.id, d.endpointId))
      .limit(1)
  )[0];
  const url = endpoint?.url ?? (d.payload as { _url?: string })._url;
  if (!url) return;

  const body = JSON.stringify(d.payload);
  const attempt = d.attempts + 1;
  let status: (typeof schema.webhookDeliveryStatus.enumValues)[number] = "failed";
  let responseStatus: number | undefined;
  let responseBody: string | undefined;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "ora-signature": d.signature,
        "ora-event-id": d.eventId,
        "ora-event-type": d.eventType,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    responseStatus = res.status;
    responseBody = (await res.text()).slice(0, 500);
    status = res.ok ? "delivered" : attempt >= MAX_ATTEMPTS ? "failed" : "retrying";
  } catch (err) {
    responseBody = err instanceof Error ? err.message : String(err);
    status = attempt >= MAX_ATTEMPTS ? "failed" : "retrying";
  }

  await db
    .update(schema.webhookDeliveries)
    .set({
      status,
      attempts: attempt,
      responseStatus,
      responseBody,
      deliveredAt: status === "delivered" ? new Date() : null,
      nextAttemptAt:
        status === "retrying"
          ? new Date(Date.now() + (BACKOFF_MS[attempt] ?? 600_000))
          : null,
    })
    .where(eq(schema.webhookDeliveries.id, deliveryId));

  logger.info({ deliveryId, status, responseStatus, attempt }, "webhook delivery attempt");
}

/** Build, sign, persist and attempt a webhook for an intent event. */
export async function emitWebhook(
  intentId: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  const targets = await endpointsFor(intentId);
  if (targets.length === 0) return;

  const event: WebhookEvent = {
    id: newId("evt"),
    type,
    createdAt: new Date().toISOString(),
    data: { paymentIntentId: intentId, ...data },
  };
  const body = JSON.stringify(event);

  for (const t of targets) {
    const deliveryId = newId("whd");
    try {
      const endpointId = t.id.startsWith("whe_intent_")
        ? await ensureIntentEndpoint(t)
        : t.id;
      const inserted = await db
        .insert(schema.webhookDeliveries)
        .values({
          id: deliveryId,
          endpointId,
          paymentIntentId: intentId,
          eventType: type,
          eventId: event.id,
          payload: event as unknown as Record<string, unknown>,
          signature: signWebhook(t.secret, body),
          status: "pending",
        })
        .onConflictDoNothing()
        .returning({ id: schema.webhookDeliveries.id });
      if (inserted[0]) await attemptDelivery(inserted[0].id);
    } catch (err) {
      logger.error({ err, intentId, type }, "webhook emit failed");
    }
  }
}

/** ad-hoc per-intent webhook URLs still need an endpoint row for the FK */
async function ensureIntentEndpoint(t: { id: string; url: string; secret: string }): Promise<string> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.id, t.id))
    .limit(1);
  if (existing[0]) return t.id;
  const intentId = t.id.replace("whe_intent_", "");
  const intent = await getIntent(intentId);
  await db.insert(schema.webhookEndpoints).values({
    id: t.id,
    merchantId: intent!.merchantId,
    url: t.url,
    secret: t.secret,
    enabledEvents: ["*"],
    active: true,
    scope: "intent",
  });
  return t.id;
}

/** Re-send a delivery (manual replay from the dashboard). */
export async function replayDelivery(deliveryId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.webhookDeliveries)
    .set({ status: "pending" })
    .where(eq(schema.webhookDeliveries.id, deliveryId));
  await attemptDelivery(deliveryId);
}
