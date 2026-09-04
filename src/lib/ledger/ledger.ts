import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import type { Money } from "@/lib/money/money";

export type LedgerAccountType =
  (typeof schema.ledgerAccountType.enumValues)[number];

export interface AccountRef {
  type: LedgerAccountType;
  scopeId?: string | null;
  currency: string;
}

export interface PostEntry {
  account: AccountRef;
  /** signed minor units: positive = credit, negative = debit */
  amount: bigint;
  currency: string;
}

export interface PostTransactionInput {
  kind: string; // capture | fee | fx | settle | refund | reversal
  reason: string;
  paymentIntentId?: string;
  idempotencyKey?: string;
  entries: PostEntry[];
}

export class UnbalancedLedgerError extends Error {
  constructor(perCurrency: Record<string, bigint>) {
    super(
      `ledger transaction does not balance: ${Object.entries(perCurrency)
        .map(([c, v]) => `${c}=${v}`)
        .join(", ")}`,
    );
    this.name = "UnbalancedLedgerError";
  }
}

function assertBalanced(entries: PostEntry[]): void {
  const perCurrency: Record<string, bigint> = {};
  for (const e of entries) {
    perCurrency[e.currency] = (perCurrency[e.currency] ?? 0n) + e.amount;
  }
  const unbalanced = Object.fromEntries(
    Object.entries(perCurrency).filter(([, v]) => v !== 0n),
  );
  if (Object.keys(unbalanced).length > 0) {
    throw new UnbalancedLedgerError(unbalanced);
  }
}

async function getOrCreateAccountId(ref: AccountRef): Promise<string> {
  const db = await getDb();
  const scopeId = ref.scopeId ?? null;
  const existing = await db
    .select({ id: schema.ledgerAccounts.id })
    .from(schema.ledgerAccounts)
    .where(
      and(
        eq(schema.ledgerAccounts.type, ref.type),
        scopeId === null
          ? sql`${schema.ledgerAccounts.scopeId} is null`
          : eq(schema.ledgerAccounts.scopeId, scopeId),
        eq(schema.ledgerAccounts.currency, ref.currency),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const id = newId("lacc");
  await db
    .insert(schema.ledgerAccounts)
    .values({ id, type: ref.type, scopeId, currency: ref.currency })
    .onConflictDoNothing();
  const row = await db
    .select({ id: schema.ledgerAccounts.id })
    .from(schema.ledgerAccounts)
    .where(
      and(
        eq(schema.ledgerAccounts.type, ref.type),
        scopeId === null
          ? sql`${schema.ledgerAccounts.scopeId} is null`
          : eq(schema.ledgerAccounts.scopeId, scopeId),
        eq(schema.ledgerAccounts.currency, ref.currency),
      ),
    )
    .limit(1);
  return row[0]!.id;
}

/**
 * Append one balanced, immutable double-entry transaction. Throws if the
 * entries don't net to zero in every currency. Idempotent on `idempotencyKey`.
 */
export async function postTransaction(
  input: PostTransactionInput,
): Promise<{ ledgerTransactionId: string; reused: boolean }> {
  assertBalanced(input.entries);
  const db = await getDb();

  if (input.idempotencyKey) {
    const prior = await db
      .select({ id: schema.ledgerTransactions.id })
      .from(schema.ledgerTransactions)
      .where(eq(schema.ledgerTransactions.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (prior[0]) return { ledgerTransactionId: prior[0].id, reused: true };
  }

  const ltxId = newId("ltx");
  const accountIds = await Promise.all(
    input.entries.map((e) => getOrCreateAccountId(e.account)),
  );

  await db.insert(schema.ledgerTransactions).values({
    id: ltxId,
    kind: input.kind,
    reason: input.reason,
    paymentIntentId: input.paymentIntentId,
    idempotencyKey: input.idempotencyKey,
  });

  await db.insert(schema.ledgerEntries).values(
    input.entries.map((e, i) => ({
      id: newId("lent"),
      ledgerTransactionId: ltxId,
      accountId: accountIds[i]!,
      amount: e.amount,
      currency: e.currency,
    })),
  );

  return { ledgerTransactionId: ltxId, reused: false };
}

/** Balance of an account = SUM(entries.amount). Derived, never stored. */
export async function balanceOf(ref: AccountRef): Promise<bigint> {
  const db = await getDb();
  const accountId = await getOrCreateAccountId(ref);
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${schema.ledgerEntries.amount}), 0)` })
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.accountId, accountId));
  return BigInt(rows[0]?.total ?? "0");
}

/** Sum of all entries per currency — must be 0 for a consistent ledger. */
export async function trialBalance(): Promise<Record<string, bigint>> {
  const db = await getDb();
  const rows = await db
    .select({
      currency: schema.ledgerEntries.currency,
      total: sql<string>`sum(${schema.ledgerEntries.amount})`,
    })
    .from(schema.ledgerEntries)
    .groupBy(schema.ledgerEntries.currency);
  return Object.fromEntries(rows.map((r) => [r.currency, BigInt(r.total ?? "0")]));
}

/* ─── typed helpers for the payment lifecycle ─────────────────────────────── */

const debit = (m: Money): bigint => -m.amount;
const credit = (m: Money): bigint => m.amount;

/** Customer's bank funds land: external world -> funds pending. */
export function captureEntries(gross: Money, paymentIntentId: string): PostEntry[] {
  return [
    {
      account: { type: "external_world", currency: gross.currency },
      amount: debit(gross),
      currency: gross.currency,
    },
    {
      account: { type: "funds_pending", scopeId: paymentIntentId, currency: gross.currency },
      amount: credit(gross),
      currency: gross.currency,
    },
  ];
}

/** Ora's 1% processing fee: funds pending -> fee revenue (remainder stays pending). */
export function feeEntries(fee: Money, paymentIntentId: string): PostEntry[] {
  return [
    {
      account: { type: "funds_pending", scopeId: paymentIntentId, currency: fee.currency },
      amount: debit(fee),
      currency: fee.currency,
    },
    {
      account: { type: "processing_fee_revenue", currency: fee.currency },
      amount: credit(fee),
      currency: fee.currency,
    },
  ];
}

/**
 * Route locked: the customer's remaining funds become Ora's pool liquidity, the
 * FX spread is recognised (source-currency, mark-to-mid), and a merchant payable
 * is created in the settlement currency, funded from Ora's pool.
 * Per-currency balanced: GBP legs net 0, SGD legs net 0.
 */
export function fxAndPayableEntries(params: {
  paymentIntentId: string;
  merchantId: string;
  liquidityShare: Money; // source-currency (e.g. GBP) that Ora receives into the pool
  fxSpreadRevenue: Money; // source-currency kept beyond fair value
  merchantNet: Money; // settlement-currency (e.g. SGD) owed to the merchant
}): PostEntry[] {
  const { paymentIntentId, merchantId, liquidityShare, fxSpreadRevenue, merchantNet } =
    params;
  const src = liquidityShare.currency;
  return [
    // source-currency: remaining pending funds -> pool, minus recognised spread
    {
      account: { type: "funds_pending", scopeId: paymentIntentId, currency: src },
      amount: debit(liquidityShare),
      currency: src,
    },
    {
      account: { type: "settlement_liquidity", currency: src },
      amount: liquidityShare.amount - fxSpreadRevenue.amount,
      currency: src,
    },
    {
      account: { type: "fx_spread_revenue", currency: src },
      amount: credit(fxSpreadRevenue),
      currency: src,
    },
    // settlement-currency: Ora's pool funds the merchant payable
    {
      account: { type: "settlement_liquidity", currency: merchantNet.currency },
      amount: debit(merchantNet),
      currency: merchantNet.currency,
    },
    {
      account: {
        type: "merchant_payable",
        scopeId: merchantId,
        currency: merchantNet.currency,
      },
      amount: credit(merchantNet),
      currency: merchantNet.currency,
    },
  ];
}

/** XRPL settlement confirmed: discharge the merchant payable, value leaves Ora. */
export function payoutEntries(params: {
  merchantId: string;
  merchantNet: Money;
}): PostEntry[] {
  return [
    {
      account: {
        type: "merchant_payable",
        scopeId: params.merchantId,
        currency: params.merchantNet.currency,
      },
      amount: debit(params.merchantNet),
      currency: params.merchantNet.currency,
    },
    {
      account: { type: "external_world", currency: params.merchantNet.currency },
      amount: credit(params.merchantNet),
      currency: params.merchantNet.currency,
    },
  ];
}

/**
 * Full refund after settlement. Ora's source-currency revenue (fee + spread) and
 * pool share are reversed and the full gross returns to the customer; the
 * merchant returns the settlement-currency net into Ora's pool.
 * Per-currency balanced.
 */
export function refundEntries(params: {
  merchantId: string;
  grossToCustomer: Money; // presentment currency (e.g. GBP)
  processingFee: Money; // presentment currency
  fxSpread: Money; // presentment currency
  merchantNet: Money; // settlement currency (e.g. SGD)
}): PostEntry[] {
  const src = params.grossToCustomer.currency;
  const poolShare =
    params.grossToCustomer.amount - params.processingFee.amount - params.fxSpread.amount;
  return [
    {
      account: { type: "processing_fee_revenue", currency: src },
      amount: debit(params.processingFee),
      currency: src,
    },
    {
      account: { type: "fx_spread_revenue", currency: src },
      amount: debit(params.fxSpread),
      currency: src,
    },
    {
      account: { type: "settlement_liquidity", currency: src },
      amount: -poolShare,
      currency: src,
    },
    {
      account: { type: "external_world", currency: src },
      amount: credit(params.grossToCustomer),
      currency: src,
    },
    // merchant returns the settlement-currency net to Ora's pool
    {
      account: { type: "external_world", currency: params.merchantNet.currency },
      amount: debit(params.merchantNet),
      currency: params.merchantNet.currency,
    },
    {
      account: { type: "settlement_liquidity", currency: params.merchantNet.currency },
      amount: credit(params.merchantNet),
      currency: params.merchantNet.currency,
    },
  ];
}
