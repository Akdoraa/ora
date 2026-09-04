import { xrpToDrops, dropsToXrp } from "xrpl";
import type { Amount, IssuedCurrencyAmount } from "xrpl";
import Decimal from "decimal.js";
import { env } from "@/env";

export const RLUSD_ISSUER = env.RLUSD_ISSUER;
export const RLUSD_CURRENCY_HEX = env.RLUSD_CURRENCY_HEX;

export type OraAsset = "XRP" | "RLUSD";

export interface AssetAmount {
  asset: OraAsset;
  /** human decimal string, e.g. "1.50" */
  value: string;
}

/** x402 `accepts[].asset` value for this asset. */
export function x402AssetCode(asset: OraAsset): string {
  return asset === "XRP" ? "XRP" : RLUSD_CURRENCY_HEX;
}

/** x402 `accepts[].amount` value: drops for XRP, decimal string for RLUSD. */
export function x402AmountString(a: AssetAmount): string {
  return a.asset === "XRP" ? xrpToDrops(a.value) : new Decimal(a.value).toFixed(2);
}

/** Build the `Amount` field for an xrpl.js Payment. */
export function toPaymentAmount(a: AssetAmount): Amount {
  if (a.asset === "XRP") return xrpToDrops(a.value);
  const issued: IssuedCurrencyAmount = {
    currency: RLUSD_CURRENCY_HEX,
    issuer: RLUSD_ISSUER,
    value: new Decimal(a.value).toFixed(),
  };
  return issued;
}

export function isRlusdAmount(amount: Amount): amount is IssuedCurrencyAmount {
  return (
    typeof amount === "object" &&
    amount.currency === RLUSD_CURRENCY_HEX &&
    amount.issuer === RLUSD_ISSUER
  );
}

/** Normalise a ledger `Amount` back to a human value string. */
export function readAmount(amount: Amount): AssetAmount {
  if (typeof amount === "string") {
    return { asset: "XRP", value: dropsToXrp(amount).toString() };
  }
  if (isRlusdAmount(amount)) return { asset: "RLUSD", value: amount.value };
  return { asset: "XRP", value: "0" };
}

export function rlusdTrustSetLimit(value = "1000000") {
  return { currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_ISSUER, value };
}
