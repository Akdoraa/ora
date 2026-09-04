import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Payment, TxResponse } from "xrpl";
import { getXrplClient } from "./client";
import { getWallet, type WalletRole } from "./wallets";
import { toPaymentAmount, readAmount, type AssetAmount } from "./assets";
import { explorerTxUrl, NETWORK, NETWORK_CAIP2 } from "./network";
import { env } from "@/env";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import Decimal from "decimal.js";

const R_ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export interface ExecutePaymentInput {
  kind: "x402_payment" | "settlement" | "refund";
  from: WalletRole;
  to: string;
  amount: AssetAmount;
  /** stable invoice / intent identifier, bound on-chain to prevent replay */
  invoiceId: string;
  memo?: string;
  paymentIntentId?: string;
  /** deterministic guardrails re-checked here, independent of the LLM */
  guard?: {
    maxValue?: string; // human decimal string in the same asset
    allowedAssets?: AssetAmount["asset"][];
    allowedDestinations?: string[];
  };
}

export interface ExecutePaymentResult {
  xrplTransactionId: string;
  hash: string;
  validated: boolean;
  engineResult: string;
  ledgerIndex?: number;
  feeDrops?: string;
  explorerUrl: string;
  deliveredAsset: AssetAmount["asset"];
  deliveredValue: string;
}

export class PaymentGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentGuardError";
  }
}
export class SettlementError extends Error {
  constructor(
    message: string,
    public readonly engineResult?: string,
  ) {
    super(message);
    this.name = "SettlementError";
  }
}

function invoiceIdHex(invoiceId: string): string {
  return createHash("sha256").update(invoiceId).digest("hex").toUpperCase();
}

function memoField(kind: string, invoiceId: string, memo?: string) {
  const data = memo ?? `ora:${kind}:${invoiceId}`;
  return {
    Memo: {
      MemoType: Buffer.from("ora/payment", "utf8").toString("hex").toUpperCase(),
      MemoData: Buffer.from(data, "utf8").toString("hex").toUpperCase(),
    },
  };
}

/** Deterministic pre-sign validation. The LLM never reaches this code path. */
function validate(input: ExecutePaymentInput): void {
  if (!R_ADDRESS.test(input.to)) {
    throw new PaymentGuardError(`destination is not a classic XRPL address: ${input.to}`);
  }
  const value = new Decimal(input.amount.value);
  if (!value.isFinite() || value.lte(0)) {
    throw new PaymentGuardError(`amount must be positive: ${input.amount.value}`);
  }
  if (input.guard?.maxValue && value.gt(new Decimal(input.guard.maxValue))) {
    throw new PaymentGuardError(
      `amount ${input.amount.value} ${input.amount.asset} exceeds guard max ${input.guard.maxValue}`,
    );
  }
  if (
    input.guard?.allowedAssets &&
    !input.guard.allowedAssets.includes(input.amount.asset)
  ) {
    throw new PaymentGuardError(`asset ${input.amount.asset} not permitted for this payment`);
  }
  if (
    input.guard?.allowedDestinations &&
    !input.guard.allowedDestinations.includes(input.to)
  ) {
    throw new PaymentGuardError(`destination ${input.to} is not in the allowlist`);
  }
  if (!input.invoiceId) {
    throw new PaymentGuardError("invoiceId is required for on-chain invoice binding");
  }
}

/**
 * The transaction executor. Validates, builds, autofills, previews to the log,
 * signs LOCALLY, persists the hash, submits with `submitAndWait`, verifies the
 * validated result, and records an `xrpl_transactions` row throughout.
 * Retries once on a transient (`ter*`) result.
 */
export async function executePayment(
  input: ExecutePaymentInput,
): Promise<ExecutePaymentResult> {
  validate(input);

  const db = await getDb();
  const wallet = getWallet(input.from);
  const client = await getXrplClient();
  const log = logger.child({ kind: input.kind, from: input.from, to: input.to });

  const txRowId = newId("xtx");
  const amountField = toPaymentAmount(input.amount);
  await db.insert(schema.xrplTransactions).values({
    id: txRowId,
    paymentIntentId: input.paymentIntentId,
    kind: input.kind,
    status: "created",
    network: NETWORK,
    account: wallet.classicAddress,
    destination: input.to,
    asset: input.amount.asset,
    issuer: input.amount.asset === "RLUSD" ? env.RLUSD_ISSUER : null,
    amountDrops: input.amount.asset === "XRP" ? String(amountField) : null,
    amountValue: input.amount.asset === "RLUSD" ? input.amount.value : null,
    sourceTag: env.XRPL_SOURCE_TAG,
    invoiceId: input.invoiceId,
    memo: input.memo,
  });

  const build = (): Payment => ({
    TransactionType: "Payment",
    Account: wallet.classicAddress,
    Destination: input.to,
    Amount: amountField,
    SourceTag: env.XRPL_SOURCE_TAG,
    InvoiceID: invoiceIdHex(input.invoiceId),
    Memos: [memoField(input.kind, input.invoiceId, input.memo)],
  });

  const attempt = async (n: number): Promise<TxResponse> => {
    const prepared = await client.autofill(build());
    const signed = wallet.sign(prepared);
    // persist the hash BEFORE submitting so a crash is reconcilable, not resubmitted
    await db
      .update(schema.xrplTransactions)
      .set({
        status: "submitted",
        txHash: signed.hash,
        lastLedgerSequence: prepared.LastLedgerSequence,
        feeDrops: prepared.Fee,
        attempts: n + 1,
        submittedAt: new Date(),
        explorerUrl: explorerTxUrl(signed.hash),
      })
      .where(eq(schema.xrplTransactions.id, txRowId));
    log.info(
      {
        hash: signed.hash,
        network: NETWORK_CAIP2,
        amount: input.amount,
        lastLedgerSequence: prepared.LastLedgerSequence,
      },
      "xrpl payment: signed, submitting",
    );
    return client.submitAndWait(signed.tx_blob);
  };

  let res: TxResponse;
  try {
    res = await attempt(0);
    const engineResult = (res.result.meta as { TransactionResult?: string })
      ?.TransactionResult;
    if (engineResult && engineResult.startsWith("ter")) {
      log.warn({ engineResult }, "transient result, retrying once");
      res = await attempt(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.xrplTransactions)
      .set({ status: "failed", failureReason: message })
      .where(eq(schema.xrplTransactions.id, txRowId));
    throw new SettlementError(`XRPL submit failed: ${message}`);
  }

  const meta = res.result.meta as { TransactionResult?: string; delivered_amount?: unknown };
  const engineResult = meta?.TransactionResult ?? "unknown";
  const hash = res.result.hash;
  const validated = res.result.validated === true;
  const success = validated && engineResult === "tesSUCCESS";
  const delivered = meta?.delivered_amount
    ? readAmount(meta.delivered_amount as never)
    : input.amount;

  await db
    .update(schema.xrplTransactions)
    .set({
      status: success ? "validated" : "failed",
      validated,
      engineResult,
      ledgerIndex: res.result.ledger_index,
      validatedAt: success ? new Date() : null,
      failureReason: success ? null : `engine result ${engineResult}`,
      rawResult: res.result as unknown as Record<string, unknown>,
    })
    .where(eq(schema.xrplTransactions.id, txRowId));

  if (!success) {
    throw new SettlementError(
      `XRPL payment not successful: ${engineResult} (validated=${validated})`,
      engineResult,
    );
  }

  log.info({ hash, ledgerIndex: res.result.ledger_index }, "xrpl payment: validated");

  return {
    xrplTransactionId: txRowId,
    hash,
    validated,
    engineResult,
    ledgerIndex: res.result.ledger_index,
    feeDrops: (res.result as { Fee?: string }).Fee,
    explorerUrl: explorerTxUrl(hash),
    deliveredAsset: delivered.asset,
    deliveredValue: delivered.value,
  };
}
