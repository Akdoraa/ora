import { env } from "@/env";
import { logger } from "@/lib/logger";

/**
 * Real SMS delivery for the checkout OTP, with an honest three-tier
 * fallback:
 *   1. Twilio, if TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER are all set —
 *      reliable, but needs the user's own Twilio account (a free trial
 *      works, but trial accounts can only text numbers verified in that
 *      Twilio console).
 *   2. Textbelt, otherwise — genuinely free, no signup at all with the
 *      shared "textbelt" key, but that quota is a small pool shared by
 *      every free Textbelt user worldwide and is routinely exhausted; treat
 *      a Textbelt success as a bonus, never a guarantee.
 *   3. Neither configured, or both failed — `sendOtpSms` returns
 *      `{ sent: false }` and the caller falls back to the on-screen
 *      "Use <code>" dev chip. This function never throws; a delivery
 *      failure should never break the checkout.
 */
export interface SmsResult {
  sent: boolean;
  provider?: "twilio" | "textbelt";
  error?: string;
}

async function sendViaTwilio(phone: string, message: string): Promise<SmsResult> {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM_NUMBER: from } = env;
  if (!sid || !token || !from) return { sent: false };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, From: from, Body: message }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.warn({ phone, status: res.status, body }, "twilio sms failed");
      return { sent: false, provider: "twilio", error: body?.message ?? `HTTP ${res.status}` };
    }
    logger.info({ phone, sid: body?.sid }, "twilio sms sent");
    return { sent: true, provider: "twilio" };
  } catch (err) {
    logger.warn({ err, phone }, "twilio sms request failed");
    return { sent: false, provider: "twilio", error: err instanceof Error ? err.message : "network error" };
  }
}

async function sendViaTextbelt(phone: string, message: string): Promise<SmsResult> {
  try {
    const res = await fetch("https://textbelt.com/text", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ phone, message, key: env.TEXTBELT_KEY }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      quotaRemaining?: number;
    };
    if (!body.success) {
      logger.warn({ phone, error: body.error, quotaRemaining: body.quotaRemaining }, "textbelt sms failed");
      return { sent: false, provider: "textbelt", error: body.error ?? "unknown textbelt error" };
    }
    logger.info({ phone, quotaRemaining: body.quotaRemaining }, "textbelt sms sent");
    return { sent: true, provider: "textbelt" };
  } catch (err) {
    logger.warn({ err, phone }, "textbelt sms request failed");
    return { sent: false, provider: "textbelt", error: err instanceof Error ? err.message : "network error" };
  }
}

export async function sendOtpSms(phone: string, code: string): Promise<SmsResult> {
  // Never make a real network call from the test suite — no external
  // dependency, no chance of eating into the shared Textbelt quota, no
  // flakiness from a network blip. Tests exercise the OTP flow via the
  // devCode fallback exactly like local dev without any provider configured.
  if (env.NODE_ENV === "test") return { sent: false };

  const message = `${code} is your Ora verification code.`;

  const twilioConfigured = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
  if (twilioConfigured) {
    const result = await sendViaTwilio(phone, message);
    if (result.sent) return result;
    // fall through to Textbelt rather than giving up outright
  }

  const textbelt = await sendViaTextbelt(phone, message);
  if (textbelt.sent) return textbelt;

  return { sent: false, error: textbelt.error ?? "no SMS provider available" };
}
