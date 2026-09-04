import { NextResponse, type NextRequest } from "next/server";
import { eq, asc } from "drizzle-orm";
import { apiError } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { getDb, schema } from "@/db/client";
import { getIntent } from "@/lib/payment-intents/service";
import { isTerminal, type PaymentStatus } from "@/lib/payment-intents/state-machine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const intent = await getIntent(id);
  if (!intent) return apiError(404, "not_found", `payment intent ${id} not found`);

  const db = await getDb();
  const [run] = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.paymentIntentId, id))
    .limit(1);
  const txs = await db
    .select({
      kind: schema.xrplTransactions.kind,
      txHash: schema.xrplTransactions.txHash,
      validated: schema.xrplTransactions.validated,
      explorerUrl: schema.xrplTransactions.explorerUrl,
    })
    .from(schema.xrplTransactions)
    .where(eq(schema.xrplTransactions.paymentIntentId, id))
    .orderBy(asc(schema.xrplTransactions.createdAt));

  return NextResponse.json(
    jsonSafe({
      id: intent.id,
      status: intent.status,
      terminal: isTerminal(intent.status as PaymentStatus),
      origin: intent.origin,
      amount: intent.amount,
      currency: intent.currency,
      settlementAmount: intent.settlementAmount,
      settlementCurrency: intent.settlementCurrency,
      processingFeeAmount: intent.processingFeeAmount,
      savingsVsCardAmount: intent.savingsVsCardAmount,
      settlementSeconds: intent.settlementSeconds,
      failureReason: intent.failureReason,
      agentRun: run
        ? { id: run.id, status: run.status, mode: run.mode, summary: run.decisionSummary }
        : null,
      xrplTransactions: txs,
      updatedAt: intent.updatedAt,
    }),
  );
}
