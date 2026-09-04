import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { toJsonb } from "@/lib/json";

export interface AuditInput {
  paymentIntentId?: string;
  agentRunId?: string;
  actor: string; // system | agent | merchant:<id> | customer | admin:<id>
  type: string;
  summary: string;
  data?: Record<string, unknown>;
}

/** Append one immutable audit event. Never throws into the caller's flow. */
export async function recordAuditEvent(input: AuditInput): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(schema.auditEvents).values({
      id: newId("aud"),
      paymentIntentId: input.paymentIntentId,
      agentRunId: input.agentRunId,
      actor: input.actor,
      type: input.type,
      summary: input.summary,
      data: input.data ? toJsonb(input.data) : undefined,
    });
  } catch (err) {
    logger.error({ err, type: input.type }, "failed to write audit event");
  }
}

export async function auditTrail(paymentIntentId: string) {
  const db = await getDb();
  const { asc, eq } = await import("drizzle-orm");
  return db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.paymentIntentId, paymentIntentId))
    .orderBy(asc(schema.auditEvents.createdAt));
}
