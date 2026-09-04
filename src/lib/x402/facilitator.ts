import { createHash } from "node:crypto";
import { decode } from "xrpl";
import {
  decodePaymentSignatureHeader,
  type PaymentRequirements,
  type SettlementResponse,
  type PaymentVerifyResponse,
} from "x402-xrpl";
import { getXrplClient } from "@/lib/xrpl/client";
import { verifyTransactionByHash } from "@/lib/xrpl/verify";
import { NETWORK, NETWORK_CAIP2, explorerTxUrl } from "@/lib/xrpl/network";
import { logger } from "@/lib/logger";

export interface FacilitatorCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface VerifyResult extends PaymentVerifyResponse {
  checks: FacilitatorCheck[];
  decodedTx?: Record<string, unknown>;
}

function invoiceIdMemoHex(invoiceId: string): string {
  return Buffer.from(invoiceId, "utf8").toString("hex").toUpperCase();
}
function invoiceIdFieldHex(invoiceId: string): string {
  return createHash("sha256").update(invoiceId).digest("hex").toUpperCase();
}

function memoDatas(tx: Record<string, unknown>): string[] {
  const memos = (tx.Memos as { Memo?: { MemoData?: string } }[] | undefined) ?? [];
  return memos
    .map((m) => m.Memo?.MemoData?.toUpperCase())
    .filter((x): x is string => !!x);
}

/**
 * Ora's in-process x402 facilitator for XRPL Testnet. Runs the spec's
 * pre-submit checks on the presigned Payment, then submits and confirms a
 * validated `tesSUCCESS`.
 */
export async function verifyAndSettle(params: {
  paymentHeader: string;
  requirements: PaymentRequirements;
  invoiceId: string;
}): Promise<{ verify: VerifyResult; settlement: SettlementResponse }> {
  const checks: FacilitatorCheck[] = [];
  const add = (name: string, ok: boolean, detail?: string) =>
    checks.push({ name, ok, detail });

  const payload = decodePaymentSignatureHeader(params.paymentHeader);
  add("envelope.x402Version", payload.x402Version === 2, `v${payload.x402Version}`);
  add("envelope.scheme", payload.accepted?.scheme === "exact", payload.accepted?.scheme);

  const blob = (payload.payload as { signedTxBlob?: string }).signedTxBlob;
  add("payload.signedTxBlob", typeof blob === "string" && blob.length > 0);

  let tx: Record<string, unknown> = {};
  try {
    tx = decode(blob as string) as unknown as Record<string, unknown>;
    add("blob.decodes", true);
  } catch (err) {
    add("blob.decodes", false, err instanceof Error ? err.message : String(err));
  }

  add("tx.type", tx.TransactionType === "Payment", String(tx.TransactionType));
  add(
    "tx.destination",
    tx.Destination === params.requirements.payTo,
    `${tx.Destination} vs ${params.requirements.payTo}`,
  );

  const req = params.requirements;
  const amountMatches =
    typeof tx.Amount === "string"
      ? tx.Amount === req.amount
      : typeof tx.Amount === "object" &&
        (tx.Amount as { value?: string }).value ===
          // IOU amounts compare on decimal value
          req.amount;
  add("tx.amount", amountMatches, JSON.stringify(tx.Amount));

  add("tx.lastLedgerSequence", typeof tx.LastLedgerSequence === "number");

  const memos = memoDatas(tx);
  const boundByMemo = memos.includes(invoiceIdMemoHex(params.invoiceId));
  const boundByField =
    typeof tx.InvoiceID === "string" &&
    tx.InvoiceID.toUpperCase() === invoiceIdFieldHex(params.invoiceId);
  add("tx.invoiceBinding", boundByMemo || boundByField, boundByMemo ? "memo" : boundByField ? "InvoiceID" : "none");

  const partial =
    typeof tx.Flags === "number" && (tx.Flags & 0x00020000) === 0x00020000;
  add("tx.noPartialPayment", !partial);

  const network = NETWORK_CAIP2;
  add("requirement.network", req.network === network, `${req.network} vs ${network}`);

  const preOk = checks.every((c) => c.ok);

  if (!preOk) {
    logger.warn({ checks }, "x402 facilitator: pre-submit checks failed");
    return {
      verify: { isValid: false, invalidReason: "pre-submit checks failed", checks, decodedTx: tx },
      settlement: {
        success: false,
        transaction: "",
        network,
        errorReason: "pre-submit checks failed",
      },
    };
  }

  // Settle: submit the presigned blob and confirm a validated tesSUCCESS.
  const client = await getXrplClient();
  const submitRes = await client.submitAndWait(blob as string);
  const meta = submitRes.result.meta as { TransactionResult?: string };
  const hash = submitRes.result.hash;
  const engineResult = meta?.TransactionResult ?? "unknown";

  const verified = await verifyTransactionByHash(hash);
  add("settle.validated", verified.validated);
  add("settle.tesSUCCESS", engineResult === "tesSUCCESS", engineResult);

  const success = verified.success && engineResult === "tesSUCCESS";
  const payer = (tx.Account as string | undefined) ?? verified.account ?? null;

  return {
    verify: {
      isValid: success,
      invalidReason: success ? null : `engine result ${engineResult}`,
      payer,
      checks,
      decodedTx: tx,
    },
    settlement: {
      success,
      transaction: hash,
      network,
      payer,
      errorReason: success ? null : `engine result ${engineResult}`,
      extensions: { explorerUrl: explorerTxUrl(hash, NETWORK) },
    },
  };
}

export type { PaymentRequirements, SettlementResponse };
