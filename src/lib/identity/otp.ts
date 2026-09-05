import { customAlphabet } from "nanoid";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { demoBankProvider } from "@/lib/bank-rails/demo-provider";
import { logger } from "@/lib/logger";

const genCode = customAlphabet("0123456789", 6);
const OTP_TTL_MS = 5 * 60_000;

export class InvalidPhoneError extends Error {
  constructor(phone: string) {
    super(`"${phone}" doesn't look like a phone number`);
    this.name = "InvalidPhoneError";
  }
}
export class OtpVerificationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "OtpVerificationError";
  }
}

/** Keeps the "+" then digits only, e.g. " +44 7700 900123 " -> "+447700900123". */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");
  return `${plus}${digits}`;
}

export interface OtpChallengeResult {
  challengeId: string;
  /**
   * Demo-only. No SMS provider is wired up, so the code is handed straight
   * back in the response instead of being sent by text — a real integration
   * (Twilio Verify or similar) would never return this. Every OTP-issuing
   * call site must present it as an on-screen "demo code" hint, not a hidden
   * value the UI is expected to already know.
   */
  devCode: string;
  expiresAt: string;
}

/** Find-or-create the customer for this phone, then issue an OTP challenge. */
export async function requestOtp(rawPhone: string): Promise<OtpChallengeResult> {
  const phone = normalizePhone(rawPhone);
  if (!/^\+?\d{7,15}$/.test(phone)) {
    throw new InvalidPhoneError(rawPhone);
  }
  const db = await getDb();

  const [existing] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.phone, phone))
    .limit(1);
  if (!existing) {
    await db
      .insert(schema.customers)
      .values({ id: newId("cus"), phone })
      .onConflictDoNothing({ target: schema.customers.phone });
  }

  const code = genCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const challengeId = newId("otp");
  await db.insert(schema.otpChallenges).values({ id: challengeId, phone, code, expiresAt });

  logger.info({ phone, challengeId }, "otp: issued (demo — no SMS provider wired up)");
  return { challengeId, devCode: code, expiresAt: expiresAt.toISOString() };
}

export interface VerifiedIdentity {
  customerId: string;
  phone: string;
  savedBank: { bankId: string; bankName: string; accountMask: string } | null;
}

/** Verify a code, single-use, then report whether this phone already has a saved bank. */
export async function verifyOtp(challengeId: string, code: string): Promise<VerifiedIdentity> {
  const db = await getDb();
  const [challenge] = await db
    .select()
    .from(schema.otpChallenges)
    .where(eq(schema.otpChallenges.id, challengeId))
    .limit(1);
  if (!challenge) throw new OtpVerificationError("that code has already been used or doesn't exist");
  if (challenge.consumedAt) {
    throw new OtpVerificationError("that code has already been used — request a new one");
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    throw new OtpVerificationError("that code has expired — request a new one");
  }
  if (challenge.code !== code.trim()) {
    throw new OtpVerificationError("incorrect code");
  }

  await db
    .update(schema.otpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(schema.otpChallenges.id, challengeId));

  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.phone, challenge.phone))
    .limit(1);
  if (!customer) throw new OtpVerificationError("no customer on file for this phone");

  const [link] = await db
    .select()
    .from(schema.customerBankLinks)
    .where(
      and(
        eq(schema.customerBankLinks.customerId, customer.id),
        eq(schema.customerBankLinks.status, "active"),
      ),
    )
    .limit(1);

  return {
    customerId: customer.id,
    phone: challenge.phone,
    savedBank: link
      ? { bankId: link.bankId, bankName: link.bankName, accountMask: link.accountMask }
      : null,
  };
}

/** First-time only: remember a bank choice against this customer for next time. */
export async function linkBank(
  customerId: string,
  bankId: string,
  country: string,
): Promise<{ bankId: string; bankName: string; accountMask: string }> {
  const banks = await demoBankProvider.listBanks(country);
  const bank = banks.find((b) => b.id === bankId);
  if (!bank) throw new Error(`unknown bank "${bankId}" for country ${country}`);

  const db = await getDb();
  // one active link per customer in this demo — replace, don't accumulate
  await db
    .update(schema.customerBankLinks)
    .set({ status: "revoked" })
    .where(
      and(
        eq(schema.customerBankLinks.customerId, customerId),
        eq(schema.customerBankLinks.status, "active"),
      ),
    );

  const accountMask = `•••• ${Math.floor(1000 + Math.random() * 8999)}`;
  await db.insert(schema.customerBankLinks).values({
    id: newId("cbl"),
    customerId,
    provider: demoBankProvider.name,
    bankId: bank.id,
    bankName: bank.name,
    accountMask,
    status: "active",
  });

  return { bankId: bank.id, bankName: bank.name, accountMask };
}
