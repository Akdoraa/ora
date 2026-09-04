import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe-style signature: `t=<unix>,v1=<hex hmac-sha256 of "t.body">`.
 */
export function signWebhook(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const mac = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
): { ok: boolean; reason?: string } {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=") as [string, string]),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return { ok: false, reason: "malformed signature header" };
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSeconds) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
