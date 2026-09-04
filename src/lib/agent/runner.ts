import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { env } from "@/env";
import { money, formatMoney, toDecimalString } from "@/lib/money/money";
import {
  postTransaction,
  captureEntries,
} from "@/lib/ledger/ledger";
import { applyTransition, getIntent } from "@/lib/payment-intents/service";
import { recordAuditEvent } from "@/lib/audit/audit";
import { demoBankProvider } from "@/lib/bank-rails/demo-provider";
import { payForResource } from "@/lib/x402/client";
import { getWalletAddress } from "@/lib/xrpl/wallets";
import { xrpToDrops } from "xrpl";
import { settlePayment } from "@/lib/settlement/settle";
import { emitWebhook } from "@/lib/webhooks/emit";
import { toJsonb } from "@/lib/json";
import { agentMode } from "./model";
import { parsePaymentObjective } from "./parse-objective";
import {
  discoverMerchantOffer,
  listAndPersistRoutes,
  evaluateAndSelect,
  maybeRequestApproval,
  midRateFor,
  receiptFallback,
} from "./tools";
import { text } from "./model";
import type { ParsedConstraints } from "@/lib/policies/policy";

type Bank = "confirm" | "fail" | "expire";

export interface RunAgentInput {
  intentId: string;
  objective: string;
  policyId: string;
  /** demo hook for the failure-path scenarios */
  bankSimulation?: Bank;
}

export type RunAgentResult =
  | { status: "awaiting_approval"; approvalId: string; reasons: string[] }
  | { status: "completed"; txHash: string; x402Hash: string; settlementSeconds: number }
  | { status: "failed"; error: string; failedStep: string };

class Recorder {
  private seq = 0;
  constructor(private readonly runId: string) {}
  async step<T>(
    tool: string,
    input: Record<string, unknown>,
    fn: () => Promise<T>,
    reason?: (out: T) => string,
  ): Promise<T> {
    const started = Date.now();
    const db = await getDb();
    try {
      const out = await fn();
      await db.insert(schema.agentDecisions).values({
        id: newId("dec"),
        agentRunId: this.runId,
        seq: this.seq++,
        tool,
        input: toJsonb(input),
        output: toJsonb(out ?? {}),
        reason: reason?.(out),
        ok: true,
        durationMs: Date.now() - started,
      });
      return out;
    } catch (err) {
      await db.insert(schema.agentDecisions).values({
        id: newId("dec"),
        agentRunId: this.runId,
        seq: this.seq++,
        tool,
        input: toJsonb(input),
        output: { error: err instanceof Error ? err.message : String(err) },
        ok: false,
        durationMs: Date.now() - started,
      });
      throw err;
    }
  }
}

async function loadContext(intentId: string, policyId: string) {
  const db = await getDb();
  const intent = await getIntent(intentId);
  if (!intent) throw new Error(`intent ${intentId} not found`);
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, intent.merchantId))
    .limit(1);
  const [policy] = await db
    .select()
    .from(schema.agentPolicies)
    .where(eq(schema.agentPolicies.id, policyId))
    .limit(1);
  if (!merchant || !policy) throw new Error("merchant or policy missing");
  return { intent, merchant, policy };
}

/**
 * Run the autonomous payment agent for an intent. Deterministic orchestration
 * of typed tools; the LLM only parses the objective and writes the summary.
 * Pauses at `awaiting_approval` when the policy requires a human; resume with
 * `continueAgent`.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const db = await getDb();
  const { intent, merchant, policy } = await loadContext(input.intentId, input.policyId);

  const runId = newId("run");
  await db.insert(schema.agentRuns).values({
    id: runId,
    paymentIntentId: intent.id,
    agentPolicyId: policy.id,
    status: "running",
    mode: agentMode(),
    model: agentMode() === "live" ? env.AGENT_MODEL : "deterministic-demo",
    objectiveText: input.objective,
  });
  await db
    .update(schema.paymentIntents)
    .set({ agentRunId: runId, origin: "agent" })
    .where(eq(schema.paymentIntents.id, intent.id));
  await recordAuditEvent({
    paymentIntentId: intent.id,
    agentRunId: runId,
    actor: "agent",
    type: "agent.started",
    summary: `agent run started (${agentMode()} mode)`,
    data: { objective: input.objective },
  });

  const rec = new Recorder(runId);
  let failedStep = "init";

  try {
    // 1 — parse the objective
    failedStep = "parsePaymentObjective";
    const parsed = await rec.step(
      "parsePaymentObjective",
      { objective: input.objective },
      () =>
        parsePaymentObjective(input.objective, {
          settlementCurrency: intent.settlementCurrency,
        }),
      (r) =>
        `parsed ${Object.keys(r.constraints).length} constraints (${r.source}): ` +
        JSON.stringify(r.constraints),
    );
    await db
      .update(schema.agentRuns)
      .set({ parsedConstraints: parsed.constraints as Record<string, unknown> })
      .where(eq(schema.agentRuns.id, runId));

    await applyTransition(intent.id, "route_discovery_started", { actor: "agent" });

    // 2 — discover the merchant offer
    failedStep = "discoverMerchantOffer";
    await rec.step(
      "discoverMerchantOffer",
      { intentId: intent.id },
      async () => discoverMerchantOffer(intent, merchant),
      (o) => `offer: ${o.description} — ${o.amount} ${o.currency} → ${o.settlementCurrency}`,
    );

    // 3 — list qualified routes
    failedStep = "listQualifiedRoutes";
    const candidates = await rec.step(
      "listQualifiedRoutes",
      { pair: `${intent.currency}/${intent.settlementCurrency}` },
      () => listAndPersistRoutes(intent, merchant),
      (c) => `${c.length} candidate routes discovered`,
    );

    // 4 — inspect route terms
    failedStep = "inspectRouteTerms";
    await rec.step(
      "inspectRouteTerms",
      {},
      async () =>
        candidates.map((c) => ({
          route: c.displayName,
          feePct: c.processingFeeBps / 100,
          fxSpreadPct: c.fxSpreadBps / 100,
          seconds: c.estimatedSeconds,
          reliabilityPct: c.reliabilityBps / 100,
          synthetic: c.isSynthetic,
        })),
      () => "read cost, FX, speed, reliability and limits for each route",
    );

    // 5 — evaluate + select
    failedStep = "evaluateRoutes";
    const evaluation = await rec.step(
      "evaluateRoutes",
      { constraintsFrom: "policy ∧ objective" },
      () =>
        evaluateAndSelect(
          intent,
          policy,
          parsed.constraints as ParsedConstraints,
          candidates,
        ),
      (e) =>
        e.selected
          ? `selected ${e.selected.displayName}: ${e.selected.scoreExplanation}`
          : "no route satisfies the constraints",
    );

    if (!evaluation.selected || !evaluation.selectedDbId) {
      throw new Error(
        "no qualified route: " +
          evaluation.evaluated
            .map((r) => `${r.displayName} (${r.rejectionReasons.join(", ")})`)
            .join("; "),
      );
    }

    await applyTransition(intent.id, "route_selected", {
      actor: "agent",
      patch: { selectedRouteId: evaluation.selectedDbId },
      data: { route: evaluation.selected.key },
    });
    await db
      .update(schema.agentRuns)
      .set({
        selectedRouteId: evaluation.selectedDbId,
        decisionSummary: evaluation.selected.scoreExplanation,
      })
      .where(eq(schema.agentRuns.id, runId));

    // 6 — bank authorization (route_selected → awaiting_bank_authorization → bank_confirmed)
    failedStep = "confirmBankAuthorization";
    await applyTransition(intent.id, "bank_authorization_requested", { actor: "agent" });
    const bank = await rec.step(
      "confirmBankAuthorization",
      { method: intent.method, amount: intent.amount.toString() },
      async () => {
        const auth = await demoBankProvider.createAuthorization({
          paymentIntentId: intent.id,
          amountMinor: intent.amount,
          currency: intent.currency,
          method: intent.method === "qr" ? "qr" : "bank",
        });
        const confirmed = await demoBankProvider.confirmAuthorization(
          auth.id,
          input.bankSimulation ?? "confirm",
        );
        return confirmed;
      },
      (b) => `bank authorization ${b.status} (${b.bankName ?? b.provider}, ${b.accountMask})`,
    );

    if (bank.status !== "confirmed") {
      const event =
        bank.status === "expired" ? "bank_authorization_expired" : "bank_authorization_failed";
      await applyTransition(intent.id, event, {
        actor: "system",
        failureReason: bank.failureReason ?? bank.status,
      });
      await emitWebhook(intent.id, "payment.authorization_failed", { reason: bank.failureReason });
      await db
        .update(schema.agentRuns)
        .set({ status: "failed", failureReason: bank.failureReason, completedAt: new Date() })
        .where(eq(schema.agentRuns.id, runId));
      return { status: "failed", error: bank.failureReason ?? bank.status, failedStep };
    }

    await applyTransition(intent.id, "bank_confirmed", { actor: "system" });
    // capture: the customer's bank funds are committed
    await postTransaction({
      kind: "capture",
      reason: "demo bank authorization confirmed",
      paymentIntentId: intent.id,
      idempotencyKey: `capture:${intent.id}`,
      entries: captureEntries(money(intent.amount, intent.currency), intent.id),
    });

    // 7 — human approval gate
    failedStep = "requestHumanApproval";
    const approval = await rec.step(
      "requestHumanApproval",
      { amount: toDecimalString(money(intent.amount, intent.currency)) },
      () =>
        maybeRequestApproval({
          intent,
          policy,
          parsed: parsed.constraints as ParsedConstraints,
          isNewPayee: !(policy.approvedMerchantIds ?? []).includes(intent.merchantId),
        }),
      (a) => (a.required ? `approval required: ${a.reasons.join("; ")}` : "auto-approved by policy"),
    );

    if (approval.required && approval.approvalId) {
      await applyTransition(intent.id, "approval_required", {
        actor: "agent",
        data: { approvalId: approval.approvalId, reasons: approval.reasons },
      });
      await db
        .update(schema.agentRuns)
        .set({ status: "awaiting_approval" })
        .where(eq(schema.agentRuns.id, runId));
      await emitWebhook(intent.id, "payment.approval_required", {
        approvalId: approval.approvalId,
        reasons: approval.reasons,
      });
      await recordAuditEvent({
        paymentIntentId: intent.id,
        agentRunId: runId,
        actor: "agent",
        type: "agent.awaiting_approval",
        summary: `paused for human approval: ${approval.reasons.join("; ")}`,
      });
      return { status: "awaiting_approval", approvalId: approval.approvalId, reasons: approval.reasons };
    }

    // no approval needed — straight to x402
    await applyTransition(intent.id, "x402_quote_paid", { actor: "agent" }).catch(() => {});
    return continueAgent(intent.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, intentId: intent.id, failedStep }, "agent run failed");
    await db
      .update(schema.agentRuns)
      .set({ status: "failed", failureReason: message, completedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId));
    await recordAuditEvent({
      paymentIntentId: intent.id,
      agentRunId: runId,
      actor: "agent",
      type: "agent.failed",
      summary: `run failed at ${failedStep}: ${message}`,
    });
    return { status: "failed", error: message, failedStep };
  }
}

/**
 * Resume after human approval (or continue straight through when none was
 * needed): x402 paid quote → XRPL settlement → fulfilment → receipt.
 */
export async function continueAgent(intentId: string): Promise<RunAgentResult> {
  const db = await getDb();
  const intent = await getIntent(intentId);
  if (!intent?.agentRunId) throw new Error("no agent run for intent");
  const runId = intent.agentRunId;
  const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId)).limit(1);
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, intent.merchantId))
    .limit(1);
  const [route] = intent.selectedRouteId
    ? await db
        .select()
        .from(schema.paymentRoutes)
        .where(eq(schema.paymentRoutes.id, intent.selectedRouteId))
        .limit(1)
    : [];
  const rec = new Recorder(runId);
  let failedStep = "resume";

  try {
    await db.update(schema.agentRuns).set({ status: "running" }).where(eq(schema.agentRuns.id, runId));

    // make sure we're in x402_quote_paid (from approval_granted or bank_confirmed)
    if (intent.status === "awaiting_agent_approval") {
      await applyTransition(intentId, "approval_granted", { actor: "customer" });
    } else if (intent.status === "bank_confirmed") {
      await applyTransition(intentId, "x402_quote_paid", { actor: "agent" }).catch(() => {});
    }

    // 8 — requestPaidQuote + handleX402Payment (real HTTP 402 + XRPL Testnet payment)
    failedStep = "handleX402Payment";
    const x402Result = await rec.step(
      "handleX402Payment",
      { resource: `${env.APP_URL}/api/x402/quote` },
      async () => {
        const r = await payForResource({
          url: `${env.APP_URL}/api/x402/quote`,
          method: "POST",
          body: {
            paymentIntentId: intentId,
            amountInMinor: intent.amount.toString(),
            amountInCurrency: intent.currency,
            amountOutCurrency: intent.settlementCurrency,
            midRate: midRateFor(intent.currency, intent.settlementCurrency),
            fxSpreadBps: route?.fxSpreadBps ?? 35,
            processingFeeBps: merchant!.processingFeeBps,
          },
          fromRole: "agent",
          guard: {
            maxAmount: xrpToDrops("2"),
            allowedAsset: "XRP",
            expectedPayTo: getWalletAddress("oracle"),
          },
        });
        if (!r.paid || !r.quoteEnvelope) {
          throw new Error("x402 payment did not yield a signed quote");
        }
        return r;
      },
      (r) =>
        `paid the x402 challenge (XRPL tx ${String(r.settlementHash).slice(0, 12)}…) and received a signed FX quote valid ${new Date(
          (r.quoteEnvelope!.quote as { validUntil: number }).validUntil,
        ).toISOString()}`,
    );

    await recordAuditEvent({
      paymentIntentId: intentId,
      agentRunId: runId,
      actor: "agent",
      type: "x402.settled",
      summary: `x402 quote unlocked; XRPL tx ${x402Result.settlementHash}`,
      data: { txHash: x402Result.settlementHash, explorerUrl: x402Result.settlementExplorerUrl },
    });

    // 9 — executeXRPLSettlement + verifyXRPLTransaction + triggerMerchantFulfilment
    failedStep = "executeXRPLSettlement";
    const settlement = await rec.step(
      "executeXRPLSettlement",
      { route: route?.displayName },
      () => settlePayment(intentId),
      (s) =>
        `settled ${formatMoney(s.merchantNet)} to the merchant in ${s.settlementSeconds}s; XRPL tx ${s.txHash.slice(0, 12)}…`,
    );

    await rec.step(
      "verifyXRPLTransaction",
      { hash: settlement.txHash },
      async () => {
        const { verifyTransactionByHash } = await import("@/lib/xrpl/verify");
        const v = await verifyTransactionByHash(settlement.txHash);
        if (!v.success) throw new Error(`settlement tx not validated: ${v.engineResult}`);
        return v;
      },
      (v) => `verified on-ledger: ${v.engineResult} in ledger ${v.ledgerIndex}`,
    );

    await rec.step(
      "triggerMerchantFulfilment",
      { intentId },
      async () => {
        const [f] = await db
          .select()
          .from(schema.fulfilments)
          .where(eq(schema.fulfilments.paymentIntentId, intentId))
          .limit(1);
        return { delivered: f?.status === "delivered", fulfilmentId: f?.id };
      },
      (f) => (f.delivered ? "merchant fulfilment delivered" : "fulfilment pending"),
    );

    // 10 — generateReceipt
    failedStep = "generateReceipt";
    const x402Hash = x402Result.settlementHash ?? "";
    const summary = await rec.step(
      "generateReceipt",
      {},
      async () => {
        const fallback = receiptFallback({
          merchant: merchant!.displayName,
          merchantNet: formatMoney(settlement.merchantNet),
          settlementSeconds: settlement.settlementSeconds,
          processingFee: formatMoney(settlement.processingFee),
          savingsVsCard: formatMoney(settlement.savingsVsCard),
          txHash: settlement.txHash,
          x402Hash,
          deliverableTitle: intent.description,
        });
        const t = await text({
          label: "generateReceipt",
          system:
            "You write a 2-3 sentence plain-English summary of a completed bank payment for the payer. No crypto jargon in the customer-facing lines. State amounts, the fee, savings vs a 4% card, settlement time, and what was delivered. Mention the XRPL settlement only as 'settled on XRPL' with the short hash.",
          prompt: JSON.stringify({
            merchant: merchant!.displayName,
            merchantNet: formatMoney(settlement.merchantNet),
            processingFee: formatMoney(settlement.processingFee),
            savingsVsCard: formatMoney(settlement.savingsVsCard),
            settlementSeconds: settlement.settlementSeconds,
            settlementTxHash: settlement.txHash,
            x402TxHash: x402Hash,
            delivered: intent.description,
          }),
          fallback: () => fallback,
        });
        return t.value;
      },
      () => "receipt summary generated",
    );

    await db
      .update(schema.agentRuns)
      .set({ status: "completed", decisionSummary: summary ?? run?.decisionSummary, completedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId));
    await recordAuditEvent({
      paymentIntentId: intentId,
      agentRunId: runId,
      actor: "agent",
      type: "agent.completed",
      summary: "commercial loop complete: paid, settled, delivered",
    });

    return {
      status: "completed",
      txHash: settlement.txHash,
      x402Hash,
      settlementSeconds: settlement.settlementSeconds,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, intentId, failedStep }, "agent continue failed");
    await db
      .update(schema.agentRuns)
      .set({ status: "failed", failureReason: message, completedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId));
    await recordAuditEvent({
      paymentIntentId: intentId,
      agentRunId: runId,
      actor: "agent",
      type: "agent.failed",
      summary: `run failed at ${failedStep}: ${message}`,
    });
    return { status: "failed", error: message, failedStep };
  }
}

/** Human approves — resume the paused run. */
export async function approveAndContinue(
  intentId: string,
  approvalId: string,
  decidedBy: string,
): Promise<RunAgentResult> {
  const db = await getDb();
  await db
    .update(schema.approvalRequests)
    .set({ status: "approved", decidedBy, decidedAt: new Date() })
    .where(eq(schema.approvalRequests.id, approvalId));
  await recordAuditEvent({
    paymentIntentId: intentId,
    actor: `customer:${decidedBy}`,
    type: "approval.granted",
    summary: "human approved the payment",
  });
  return continueAgent(intentId);
}

/** Human rejects — cancel the intent. */
export async function rejectApproval(
  intentId: string,
  approvalId: string,
  decidedBy: string,
): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.approvalRequests)
    .set({ status: "rejected", decidedBy, decidedAt: new Date() })
    .where(eq(schema.approvalRequests.id, approvalId));
  await applyTransition(intentId, "approval_rejected", {
    actor: `customer:${decidedBy}`,
    failureReason: "payer rejected the payment at the approval step",
  });
  await db
    .update(schema.agentRuns)
    .set({ status: "failed", failureReason: "rejected by payer", completedAt: new Date() })
    .where(eq(schema.agentRuns.paymentIntentId, intentId));
  await emitWebhook(intentId, "payment.cancelled", { reason: "approval_rejected" });
}
