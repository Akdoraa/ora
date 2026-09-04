import { NextResponse, type NextRequest } from "next/server";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { verifyWebhook } from "@/lib/webhooks/sign";
import { env } from "@/env";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Demo webhook sink. Verifies the Ora signature and records the event so the
 * developer dashboard can show a live webhook log.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("ora-signature") ?? "";
  const check = verifyWebhook(env.WEBHOOK_SIGNING_SECRET, body, sig);

  let event: { id?: string; type?: string; data?: { paymentIntentId?: string } } = {};
  try {
    event = JSON.parse(body);
  } catch {
    /* keep empty */
  }

  const db = await getDb();
  await db.insert(schema.auditEvents).values({
    id: newId("aud"),
    paymentIntentId: event.data?.paymentIntentId,
    actor: "webhook-sink",
    type: `webhook.received.${event.type ?? "unknown"}`,
    summary: `demo sink received ${event.type} (signature ${check.ok ? "valid" : "INVALID"})`,
    data: { eventId: event.id, signatureValid: check.ok, reason: check.reason },
  });

  logger.info(
    { eventId: event.id, type: event.type, signatureValid: check.ok },
    "webhook sink received event",
  );

  if (!check.ok) {
    return NextResponse.json({ received: true, signatureValid: false, reason: check.reason }, { status: 202 });
  }
  return NextResponse.json({ received: true, signatureValid: true });
}
