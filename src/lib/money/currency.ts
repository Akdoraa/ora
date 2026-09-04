/** ISO-4217 minor-unit exponents for the currencies Ora handles in the demo. */
export const CURRENCY_EXPONENT: Record<string, number> = {
  GBP: 2,
  SGD: 2,
  USD: 2,
  EUR: 2,
  AUD: 2,
  HKD: 2,
  JPY: 0,
  // RLUSD is treated as a 2dp presentment currency in UI; on-ledger it carries
  // its own precision handled by the xrpl layer.
  RLUSD: 2,
};

export function exponentOf(currency: string): number {
  const e = CURRENCY_EXPONENT[currency.toUpperCase()];
  if (e === undefined) {
    throw new Error(`Unknown currency: ${currency}`);
  }
  return e;
}

export function isSupportedCurrency(currency: string): boolean {
  return currency.toUpperCase() in CURRENCY_EXPONENT;
}
