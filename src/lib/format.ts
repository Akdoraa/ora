import { money, formatMoney, type Money } from "@/lib/money/money";

/** Format a minor-unit amount (string from the JSON-safe API, or bigint). */
export function fmtMinor(
  minor: string | bigint | number | null | undefined,
  currency: string,
): string {
  if (minor === null || minor === undefined) return "—";
  try {
    return formatMoney(money(BigInt(minor), currency));
  } catch {
    return `${minor} ${currency}`;
  }
}

export function fmtMoney(m: Money): string {
  return formatMoney(m);
}

export function fmtPct(bps: number | null | undefined, dp = 2): string {
  if (bps === null || bps === undefined) return "—";
  return `${(bps / 100).toFixed(dp)}%`;
}

export function shortHash(hash: string | null | undefined, head = 8, tail = 6): string {
  if (!hash) return "—";
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function humanSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172_800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} days`;
}

export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso as string).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}
