import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { useTestDb, resetTestDb } from "@/test/db";
import { createPaymentIntent } from "@/test/fixtures";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";

const executePayment = vi.fn();
vi.mock("@/lib/xrpl/executor", () => ({
  executePayment: (...args: unknown[]) => executePayment(...args),
}));
vi.mock("@/lib/xrpl/wallets", () => ({
  getWallet: () => ({ classicAddress: "rAgentFakeDestinationAddress0000000" }),
}));

const { processRefund } = await import("./refund");

const FAKE_HASH = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF012345678";

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  executePayment.mockReset();
  // Mirror what the real executor does: a settled payment always leaves a
  // row behind in xrpl_transactions (refunds.xrpl_transaction_id has a FK
  // to it), so the mock inserts one too rather than handing back a
  // dangling id.
  executePayment.mockImplementation(async (input: { paymentIntentId?: string }) => {
    const db = await getDb();
    const [row] = await db
      .insert(schema.xrplTransactions)
      .values({
        id: newId("xtx"),
        paymentIntentId: input.paymentIntentId,
        kind: "refund",
        status: "validated",
        account: "rSettlementFakeAddress0000000000000",
        destination: "rAgentFakeDestinationAddress0000000",
        amountDrops: "500000",
        asset: "XRP",
        txHash: FAKE_HASH,
        engineResult: "tesSUCCESS",
        validated: true,
        explorerUrl: `https://testnet.xrpl.org/transactions/${FAKE_HASH}`,
      })
      .returning();
    if (!row) throw new Error("test setup: xrpl_transactions insert returned no row");
    return {
      hash: FAKE_HASH,
      xrplTransactionId: row.id,
      explorerUrl: row.explorerUrl,
      validated: true,
      engineResult: "tesSUCCESS",
      deliveredAsset: "XRP" as const,
      deliveredValue: "0.5",
    };
  });
});

describe("processRefund", () => {
  it("persists the on-chain refund's xrplTransactionId onto the refund row", async () => {
    const { id: intentId } = await createPaymentIntent({
      status: "paid",
      amount: 425_000n,
      currency: "GBP",
      settlementCurrency: "SGD",
      settlementAmount: 720_319n,
      merchantNetAmount: 720_319n,
      processingFeeAmount: 4_250n,
    });

    const result = await processRefund({ intentId, reason: "test refund" });

    expect(result.status).toBe("succeeded");
    expect(result.xrplTxHash).toBe(FAKE_HASH);
    expect(executePayment).toHaveBeenCalledTimes(1);

    const db = await getDb();
    const [row] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, result.refundId))
      .limit(1);
    expect(row).toBeDefined();
    // regression guard: this column used to be written as
    // `xrplTxHash ? undefined : undefined` — always undefined, no matter
    // what the executor returned.
    expect(row!.xrplTransactionId).not.toBeNull();
    expect(row!.xrplTransactionId).toMatch(/^xtx_/);
    expect(row!.status).toBe("succeeded");
  });

  it("still succeeds — ledger-only — when the on-chain leg fails", async () => {
    executePayment.mockRejectedValueOnce(new Error("wallet not configured"));
    const { id: intentId } = await createPaymentIntent({
      status: "paid",
      amount: 100_00n,
      currency: "GBP",
      settlementCurrency: "SGD",
    });

    const result = await processRefund({ intentId });

    expect(result.status).toBe("succeeded");
    expect(result.xrplTxHash).toBeUndefined();

    const db = await getDb();
    const [row] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, result.refundId))
      .limit(1);
    expect(row!.xrplTransactionId).toBeNull();
    expect(row!.status).toBe("succeeded");
  });

  it("transitions the payment intent to refunded", async () => {
    const { id: intentId } = await createPaymentIntent({ status: "paid" });
    await processRefund({ intentId });

    const db = await getDb();
    const [intent] = await db
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.id, intentId))
      .limit(1);
    expect(intent!.status).toBe("refunded");
  });

  it("is idempotent on idempotencyKey — a second call returns the same refund without re-executing", async () => {
    const { id: intentId } = await createPaymentIntent({ status: "paid" });
    const first = await processRefund({ intentId, idempotencyKey: "refund-once" });
    const second = await processRefund({ intentId, idempotencyKey: "refund-once" });

    expect(second.refundId).toBe(first.refundId);
    expect(executePayment).toHaveBeenCalledTimes(1);
  });

  it("rejects a refund on an intent that was never paid", async () => {
    const { id: intentId } = await createPaymentIntent({ status: "created" });
    await expect(processRefund({ intentId })).rejects.toThrow(/cannot refund/);
  });
});
