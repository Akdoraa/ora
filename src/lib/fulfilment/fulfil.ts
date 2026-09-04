import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { applyTransition, getIntent } from "@/lib/payment-intents/service";
import { recordAuditEvent } from "@/lib/audit/audit";
import { emitWebhook } from "@/lib/webhooks/emit";
import type { Fulfilment } from "@/db/schema";

const token = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 20);

export interface Deliverable {
  kind: string;
  title: string;
  summary: string;
  files?: { name: string; sizeLabel: string; contentType: string }[];
  apiCredentials?: { apiKey: string; credits: number; baseUrl: string };
  [k: string]: unknown;
}

/**
 * Deliver the purchased outcome. Only ever called AFTER a verified settlement.
 * Idempotent — a second call returns the existing fulfilment.
 */
export async function deliverFulfilment(intentId: string): Promise<Fulfilment> {
  const db = await getDb();
  const existing = (
    await db
      .select()
      .from(schema.fulfilments)
      .where(eq(schema.fulfilments.paymentIntentId, intentId))
      .limit(1)
  )[0];
  if (existing && existing.status === "delivered") return existing;

  const intent = await getIntent(intentId);
  if (!intent) throw new Error(`intent ${intentId} not found`);
  if (intent.status !== "paid") {
    throw new Error(`cannot fulfil intent in status ${intent.status} (must be paid)`);
  }

  const product = intent.productId
    ? (
        await db
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, intent.productId))
          .limit(1)
      )[0]
    : undefined;

  const accessToken = token();
  const deliverable: Deliverable = (product?.deliverable as Deliverable | undefined) ?? {
    kind: "digital",
    title: intent.description,
    summary: "Digital delivery unlocked by Ora after settlement.",
  };
  if (deliverable.apiCredentials) {
    deliverable.apiCredentials = {
      ...deliverable.apiCredentials,
      apiKey: `sk_live_${token().toLowerCase()}`,
    };
  }

  const id = existing?.id ?? newId("ful");
  const values = {
    id,
    paymentIntentId: intentId,
    status: "delivered" as const,
    kind: product?.kind ?? "digital",
    deliverable: deliverable as unknown as Record<string, unknown>,
    accessToken,
    deliveredAt: new Date(),
  };
  const [row] = existing
    ? await db
        .update(schema.fulfilments)
        .set(values)
        .where(eq(schema.fulfilments.id, id))
        .returning()
    : await db.insert(schema.fulfilments).values(values).returning();

  await applyTransition(intentId, "fulfilment_succeeded", { actor: "agent" });
  await recordAuditEvent({
    paymentIntentId: intentId,
    actor: "agent",
    type: "fulfilment.delivered",
    summary: `delivered "${deliverable.title}"`,
  });
  await emitWebhook(intentId, "payment.delivered", { fulfilmentId: id });

  return row!;
}

export async function getDeliverable(
  intentId: string,
  accessToken: string,
): Promise<Deliverable | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.fulfilments)
    .where(eq(schema.fulfilments.paymentIntentId, intentId))
    .limit(1);
  if (!row || row.accessToken !== accessToken || row.status !== "delivered") return null;
  return row.deliverable as Deliverable;
}
