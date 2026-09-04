import { describe, it, expect, vi, beforeEach } from "vitest";
import { Wallet, type Payment } from "xrpl";
import { buildPaymentSignatureHeaderForSignedBlob, type PaymentRequirements } from "x402-xrpl";

// Stub the network-touching modules; everything else (decode, header parsing,
// the pre-submit checks) runs for real against locally-signed transactions.
const submitAndWait = vi.fn();
vi.mock("@/lib/xrpl/client", () => ({
  getXrplClient: async () => ({ submitAndWait }),
}));
const verifyTransactionByHash = vi.fn();
vi.mock("@/lib/xrpl/verify", () => ({
  verifyTransactionByHash: (...args: unknown[]) => verifyTransactionByHash(...args),
}));

const { verifyAndSettle } = await import("./facilitator");

const PAY_TO = "rB7fRYCLLj7V5ctcYtx3eVT42GABVaMh7H";
const INVOICE_ID = "ora-x402-quote:pi_test";

function requirement(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "xrpl:1",
    amount: "1000000",
    asset: "XRP",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { invoiceId: INVOICE_ID, sourceTag: 20260530 },
    ...overrides,
  };
}

function invoiceIdMemo(invoiceId: string) {
  return {
    Memo: { MemoData: Buffer.from(invoiceId, "utf8").toString("hex").toUpperCase() },
  };
}

/** Build + locally sign a Payment (no network) and wrap it as a PAYMENT-SIGNATURE header. */
function signedHeader(
  txOverrides: Record<string, unknown> = {},
  invoiceId = INVOICE_ID,
  req = requirement(),
) {
  const wallet = Wallet.generate();
  const tx = {
    TransactionType: "Payment",
    Account: wallet.classicAddress,
    Destination: PAY_TO,
    Amount: "1000000",
    Fee: "12",
    Sequence: 1,
    LastLedgerSequence: 999_999_999,
    SourceTag: 20260530,
    Memos: [invoiceIdMemo(invoiceId)],
    ...txOverrides,
  } as unknown as Payment;
  const signed = wallet.sign(tx);
  const header = buildPaymentSignatureHeaderForSignedBlob({
    req,
    signedTxBlob: signed.tx_blob,
    invoiceId,
  });
  return { header, payer: wallet.classicAddress, hash: signed.hash };
}

beforeEach(() => {
  submitAndWait.mockReset();
  verifyTransactionByHash.mockReset();
});

describe("x402 facilitator — pre-submit checks", () => {
  it("accepts a well-formed presigned payment and settles it", async () => {
    const { header, hash } = signedHeader();
    submitAndWait.mockResolvedValue({
      result: { hash, meta: { TransactionResult: "tesSUCCESS" }, validated: true },
    });
    verifyTransactionByHash.mockResolvedValue({ validated: true, success: true });

    const { verify, settlement } = await verifyAndSettle({
      paymentHeader: header,
      requirements: requirement(),
      invoiceId: INVOICE_ID,
    });

    expect(verify.checks.every((c) => c.ok)).toBe(true);
    expect(verify.isValid).toBe(true);
    expect(settlement.success).toBe(true);
    expect(settlement.transaction).toBe(hash);
    expect(submitAndWait).toHaveBeenCalledTimes(1);
  });

  it("rejects a payment to the wrong destination before ever submitting", async () => {
    const wrongDestination = Wallet.generate().classicAddress; // real, valid, just not payTo
    const { header } = signedHeader({ Destination: wrongDestination });
    const { verify, settlement } = await verifyAndSettle({
      paymentHeader: header,
      requirements: requirement(),
      invoiceId: INVOICE_ID,
    });

    expect(verify.isValid).toBe(false);
    expect(verify.checks.find((c) => c.name === "tx.destination")?.ok).toBe(false);
    expect(settlement.success).toBe(false);
    expect(submitAndWait).not.toHaveBeenCalled();
  });

  it("rejects an amount that doesn't match the requirement", async () => {
    const { header } = signedHeader({ Amount: "1" }); // 1 drop instead of 1,000,000
    const { verify } = await verifyAndSettle({
      paymentHeader: header,
      requirements: requirement(),
      invoiceId: INVOICE_ID,
    });

    expect(verify.checks.find((c) => c.name === "tx.amount")?.ok).toBe(false);
    expect(verify.isValid).toBe(false);
    expect(submitAndWait).not.toHaveBeenCalled();
  });

  it("rejects a payment missing the invoice binding (replay protection)", async () => {
    const { header } = signedHeader({ Memos: [invoiceIdMemo("a-totally-different-invoice")] });
    const { verify } = await verifyAndSettle({
      paymentHeader: header,
      requirements: requirement(),
      invoiceId: INVOICE_ID,
    });

    expect(verify.checks.find((c) => c.name === "tx.invoiceBinding")?.ok).toBe(false);
    expect(verify.isValid).toBe(false);
  });

  it("rejects a partial payment (tfPartialPayment flag set)", async () => {
    const { header } = signedHeader({ Flags: 0x00020000 });
    const { verify } = await verifyAndSettle({
      paymentHeader: header,
      requirements: requirement(),
      invoiceId: INVOICE_ID,
    });

    expect(verify.checks.find((c) => c.name === "tx.noPartialPayment")?.ok).toBe(false);
  });

  it("rejects a network mismatch (e.g. a mainnet-labelled requirement on a testnet facilitator)", async () => {
    const { header } = signedHeader({}, INVOICE_ID, requirement({ network: "xrpl:0" }));
    const { verify } = await verifyAndSettle({
      paymentHeader: header,
      requirements: requirement({ network: "xrpl:0" }),
      invoiceId: INVOICE_ID,
    });
    // network xrpl:0 (mainnet) requirement vs this facilitator's NETWORK_CAIP2 (xrpl:1, testnet)
    expect(verify.checks.find((c) => c.name === "requirement.network")?.ok).toBe(false);
  });

  it("marks the settlement failed when the ledger itself rejects the transaction", async () => {
    const { header, hash } = signedHeader();
    submitAndWait.mockResolvedValue({
      result: { hash, meta: { TransactionResult: "tecNO_DST" }, validated: true },
    });
    verifyTransactionByHash.mockResolvedValue({ validated: true, success: false });

    const { verify, settlement } = await verifyAndSettle({
      paymentHeader: header,
      requirements: requirement(),
      invoiceId: INVOICE_ID,
    });

    // pre-submit checks all passed, so it DID submit...
    expect(submitAndWait).toHaveBeenCalledTimes(1);
    // ...but the engine result means it's not a valid settlement
    expect(verify.isValid).toBe(false);
    expect(settlement.success).toBe(false);
  });
});
