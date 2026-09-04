import { getXrplClient } from "./client";
import { readAmount } from "./assets";
import { explorerTxUrl, NETWORK } from "./network";
import type { Amount } from "xrpl";

export interface TxVerification {
  found: boolean;
  hash: string;
  validated: boolean;
  success: boolean;
  engineResult?: string;
  ledgerIndex?: number;
  account?: string;
  destination?: string;
  deliveredAsset?: "XRP" | "RLUSD";
  deliveredValue?: string;
  feeDrops?: string;
  memos?: string[];
  invoiceId?: string;
  explorerUrl: string;
}

function decodeMemos(tx: Record<string, unknown>): string[] {
  const memos = (tx.Memos as { Memo?: { MemoData?: string } }[] | undefined) ?? [];
  return memos
    .map((m) => m.Memo?.MemoData)
    .filter((h): h is string => typeof h === "string")
    .map((h) => {
      try {
        return Buffer.from(h, "hex").toString("utf8");
      } catch {
        return h;
      }
    });
}

/**
 * Verify a transaction is real, on this network, in a validated ledger, and
 * succeeded. Never trust a submit response alone — this re-reads from a node.
 */
export async function verifyTransactionByHash(hash: string): Promise<TxVerification> {
  const client = await getXrplClient();
  const base: TxVerification = {
    found: false,
    hash,
    validated: false,
    success: false,
    explorerUrl: explorerTxUrl(hash),
  };

  let res;
  try {
    res = await client.request({ command: "tx", transaction: hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("txnNotFound")) return base;
    throw err;
  }

  const r = res.result as unknown as Record<string, unknown>;
  // rippled >= 2.3 nests the transaction under `tx_json`; older responses are flat.
  const tx = ((r.tx_json as Record<string, unknown> | undefined) ?? r) as Record<
    string,
    unknown
  >;
  const meta = (r.meta ?? r.metaData) as Record<string, unknown> | undefined;
  const engineResult =
    (meta?.TransactionResult as string | undefined) ??
    (r.engine_result as string | undefined);
  const validated = r.validated === true;
  const delivered =
    (meta?.delivered_amount as Amount | undefined) ??
    (tx.DeliverMax as Amount | undefined) ??
    (tx.Amount as Amount | undefined);
  const deliveredParsed = delivered ? readAmount(delivered) : undefined;

  return {
    found: true,
    hash,
    validated,
    success: validated && engineResult === "tesSUCCESS",
    engineResult,
    ledgerIndex:
      (r.ledger_index as number | undefined) ??
      (r.inLedger as number | undefined),
    account: tx.Account as string | undefined,
    destination: tx.Destination as string | undefined,
    deliveredAsset: deliveredParsed?.asset,
    deliveredValue: deliveredParsed?.value,
    feeDrops: tx.Fee as string | undefined,
    memos: decodeMemos(tx),
    invoiceId: tx.InvoiceID as string | undefined,
    explorerUrl: explorerTxUrl(hash, NETWORK),
  };
}
