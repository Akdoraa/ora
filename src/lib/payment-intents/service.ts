import { eq, desc, asc } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { recordAuditEvent } from "@/lib/audit/audit";
import {
  transition,
  isTerminal,
  type PaymentEvent,
  type PaymentStatus,
} from "./state-machine";
import type { PaymentIntent } from "@/db/schema";

export async function getIntent(id: string): Promise<PaymentIntent | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.paymentIntents)
    .where(eq(schema.paymentIntents.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export class IntentNotFoundError extends Error {
  constructor(id: string) {
    super(`payment intent ${id} not found`);
    this.name = "IntentNotFoundError";
  }
}

export interface ApplyTransitionOptions {
  actor?: string;
  failureReason?: string;
  data?: Record<string, unknown>;
  patch?: Partial<typeof schema.paymentIntents.$inferInsert>;
}

/**
 * The one place a payment intent's status changes. Validates the move through
 * the state machine, persists it (plus any field patch), and writes an audit
 * event. Throws InvalidTransitionError on an illegal move.
 */
export async function applyTransition(
  intentId: string,
  event: PaymentEvent,
  opts: ApplyTransitionOptions = {},
): Promise<PaymentIntent> {
  const db = await getDb();
  const intent = await getIntent(intentId);
  if (!intent) throw new IntentNotFoundError(intentId);

  const result = transition(intent.status as PaymentStatus, event);

  const [updated] = await db
    .update(schema.paymentIntents)
    .set({
      status: result.to,
      failureReason: opts.failureReason ?? intent.failureReason,
      updatedAt: new Date(),
      ...opts.patch,
    })
    .where(eq(schema.paymentIntents.id, intentId))
    .returning();

  await recordAuditEvent({
    paymentIntentId: intentId,
    actor: opts.actor ?? "system",
    type: `payment.${event}`,
    summary: `${result.from} → ${result.to}`,
    data: { event, from: result.from, to: result.to, ...opts.data },
  });

  return updated!;
}

export interface CreatePaymentIntentInput {
  merchantId: string;
  amount: bigint;
  currency: string;
  settlementCurrency?: string;
  description: string;
  reference?: string;
  productId?: string;
  origin?: "human" | "agent";
  method?: "bank" | "qr" | "agent";
  customerId?: string;
  agentPolicyId?: string;
  successUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
  expiresInSeconds?: number;
}

export async function createPaymentIntent(
  input: CreatePaymentIntentInput,
): Promise<PaymentIntent> {
  const db = await getDb();
  const merchant = (
    await db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.id, input.merchantId))
      .limit(1)
  )[0];
  if (!merchant) throw new Error(`merchant ${input.merchantId} not found`);

  const id = newId("pi");
  const [row] = await db
    .insert(schema.paymentIntents)
    .values({
      id,
      merchantId: input.merchantId,
      customerId: input.customerId,
      productId: input.productId,
      status: "created",
      origin: input.origin ?? "human",
      method: input.method ?? "bank",
      description: input.description,
      reference: input.reference,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      settlementCurrency: (
        input.settlementCurrency ?? merchant.settlementCurrency
      ).toUpperCase(),
      estimatedCardFeeAmount:
        (input.amount * BigInt(merchant.cardBaselineBps)) / 10_000n,
      agentPolicyId: input.agentPolicyId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      webhookUrl: input.webhookUrl,
      metadata: input.metadata,
      expiresAt: input.expiresInSeconds
        ? new Date(Date.now() + input.expiresInSeconds * 1000)
        : new Date(Date.now() + 30 * 60_000),
    })
    .returning();

  await recordAuditEvent({
    paymentIntentId: id,
    actor: `merchant:${input.merchantId}`,
    type: "payment.created",
    summary: `payment intent created for ${input.description}`,
    data: { amount: input.amount.toString(), currency: input.currency },
  });

  return row!;
}

/** Full aggregate for the checkout / receipt / dashboard views. */
export async function getIntentAggregate(id: string) {
  const db = await getDb();
  const intent = await getIntent(id);
  if (!intent) return null;

  const [
    merchant,
    product,
    routes,
    bankAuths,
    agentRun,
    approvals,
    x402,
    xrplTxs,
    settlement,
    fulfilment,
    audit,
  ] = await Promise.all([
    db.select().from(schema.merchants).where(eq(schema.merchants.id, intent.merchantId)).limit(1),
    intent.productId
      ? db.select().from(schema.products).where(eq(schema.products.id, intent.productId)).limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(schema.paymentRoutes)
      .where(eq(schema.paymentRoutes.paymentIntentId, id))
      .orderBy(asc(schema.paymentRoutes.totalCostAmount)),
    db
      .select()
      .from(schema.bankAuthorizations)
      .where(eq(schema.bankAuthorizations.paymentIntentId, id))
      .orderBy(desc(schema.bankAuthorizations.createdAt)),
    db.select().from(schema.agentRuns).where(eq(schema.agentRuns.paymentIntentId, id)).limit(1),
    db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.paymentIntentId, id))
      .orderBy(desc(schema.approvalRequests.createdAt)),
    db.select().from(schema.x402Payments).where(eq(schema.x402Payments.paymentIntentId, id)).limit(1),
    db
      .select()
      .from(schema.xrplTransactions)
      .where(eq(schema.xrplTransactions.paymentIntentId, id))
      .orderBy(asc(schema.xrplTransactions.createdAt)),
    db.select().from(schema.settlements).where(eq(schema.settlements.paymentIntentId, id)).limit(1),
    db.select().from(schema.fulfilments).where(eq(schema.fulfilments.paymentIntentId, id)).limit(1),
    db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.paymentIntentId, id))
      .orderBy(asc(schema.auditEvents.createdAt)),
  ]);

  const runId = agentRun[0]?.id;
  const agentDecisions = runId
    ? await db
        .select()
        .from(schema.agentDecisions)
        .where(eq(schema.agentDecisions.agentRunId, runId))
        .orderBy(asc(schema.agentDecisions.seq))
    : [];

  return {
    intent,
    merchant: merchant[0] ?? null,
    product: product[0] ?? null,
    routes,
    bankAuthorizations: bankAuths,
    agentRun: agentRun[0] ?? null,
    agentDecisions,
    approvals,
    x402: x402[0] ?? null,
    xrplTransactions: xrplTxs,
    settlement: settlement[0] ?? null,
    fulfilment: fulfilment[0] ?? null,
    audit,
    isTerminal: isTerminal(intent.status as PaymentStatus),
  };
}
