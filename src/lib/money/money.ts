/**
 * Exact money. Amounts are integer minor units (`bigint`) tagged with an ISO
 * currency. No floating point ever touches an amount. FX and percentage math
 * goes through decimal.js with an explicit rounding mode.
 */
import Decimal from "decimal.js";
import { exponentOf } from "./currency";

Decimal.set({ precision: 40 });

export type Rounding = "half_up" | "half_even" | "down" | "up";

const DECIMAL_ROUNDING: Record<Rounding, Decimal.Rounding> = {
  half_up: Decimal.ROUND_HALF_UP,
  half_even: Decimal.ROUND_HALF_EVEN,
  down: Decimal.ROUND_DOWN,
  up: Decimal.ROUND_UP,
};

export interface Money {
  /** integer minor units */
  readonly amount: bigint;
  /** ISO-4217 code, upper-case */
  readonly currency: string;
}

export function money(amount: bigint | number | string, currency: string): Money {
  const cur = currency.toUpperCase();
  if (typeof amount === "bigint") return { amount, currency: cur };
  if (typeof amount === "number") {
    if (!Number.isInteger(amount)) {
      throw new Error(`money() got a non-integer number: ${amount} (pass minor units)`);
    }
    return { amount: BigInt(amount), currency: cur };
  }
  return { amount: BigInt(amount), currency: cur };
}

/** Parse a human decimal string ("4250.00") into Money for the currency. */
export function moneyFromDecimal(value: string | number, currency: string): Money {
  const cur = currency.toUpperCase();
  const exp = exponentOf(cur);
  const scaled = new Decimal(value).times(new Decimal(10).pow(exp));
  if (!scaled.isInteger()) {
    // more precision supplied than the currency supports
    return { amount: BigInt(scaled.toFixed(0, Decimal.ROUND_HALF_UP)), currency: cur };
  }
  return { amount: BigInt(scaled.toFixed(0)), currency: cur };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function negate(a: Money): Money {
  return { amount: -a.amount, currency: a.currency };
}

export function isZero(a: Money): boolean {
  return a.amount === 0n;
}

export function isNegative(a: Money): boolean {
  return a.amount < 0n;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

export function gt(a: Money, b: Money): boolean {
  return compare(a, b) === 1;
}
export function gte(a: Money, b: Money): boolean {
  return compare(a, b) >= 0;
}
export function lt(a: Money, b: Money): boolean {
  return compare(a, b) === -1;
}
export function lte(a: Money, b: Money): boolean {
  return compare(a, b) <= 0;
}

/**
 * Percentage in basis points (100 bps = 1.00%). Returns the fee portion,
 * rounded to the currency's minor unit. Default rounding favours the fee
 * collector (half up).
 */
export function applyBps(
  base: Money,
  bps: number,
  rounding: Rounding = "half_up",
): Money {
  const fee = new Decimal(base.amount.toString())
    .times(bps)
    .div(10_000)
    .toDecimalPlaces(0, DECIMAL_ROUNDING[rounding]);
  return { amount: BigInt(fee.toFixed(0)), currency: base.currency };
}

/**
 * Convert `from` into `toCurrency` at `rate` (decimal string: 1 unit of
 * `from.currency` = `rate` units of `toCurrency`). Handles differing minor-unit
 * exponents. Rounding defaults to half-even (bankers') for conversions.
 */
export function convert(
  from: Money,
  rate: string | number,
  toCurrency: string,
  rounding: Rounding = "half_even",
): Money {
  const toCur = toCurrency.toUpperCase();
  const fromExp = exponentOf(from.currency);
  const toExp = exponentOf(toCur);
  const converted = new Decimal(from.amount.toString())
    .div(new Decimal(10).pow(fromExp))
    .times(new Decimal(rate))
    .times(new Decimal(10).pow(toExp))
    .toDecimalPlaces(0, DECIMAL_ROUNDING[rounding]);
  return { amount: BigInt(converted.toFixed(0)), currency: toCur };
}

/** Effective all-in rate implied by `to` per unit of `from` (decimal string). */
export function impliedRate(from: Money, to: Money): string {
  const fromExp = exponentOf(from.currency);
  const toExp = exponentOf(to.currency);
  return new Decimal(to.amount.toString())
    .div(new Decimal(10).pow(toExp))
    .div(new Decimal(from.amount.toString()).div(new Decimal(10).pow(fromExp)))
    .toFixed(8);
}

export function toDecimalString(m: Money): string {
  const exp = exponentOf(m.currency);
  const neg = m.amount < 0n;
  const abs = (neg ? -m.amount : m.amount).toString().padStart(exp + 1, "0");
  const whole = abs.slice(0, abs.length - exp) || "0";
  const frac = exp > 0 ? "." + abs.slice(abs.length - exp) : "";
  return `${neg ? "-" : ""}${whole}${frac}`;
}

export function toNumber(m: Money): number {
  return Number(toDecimalString(m));
}

/** Locale-aware display, e.g. "£4,250.00" / "S$5,732.10". */
export function formatMoney(m: Money, locale = "en-GB"): string {
  const exp = exponentOf(m.currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: m.currency === "RLUSD" ? "USD" : m.currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(toNumber(m)).replace("USD", "RLUSD");
  } catch {
    return `${toDecimalString(m)} ${m.currency}`;
  }
}

export const zero = (currency: string): Money => ({
  amount: 0n,
  currency: currency.toUpperCase(),
});
