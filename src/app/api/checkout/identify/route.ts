import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, apiError } from "@/lib/api/http";
import { requestOtp, InvalidPhoneError } from "@/lib/identity/otp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ phone: z.string().min(7).max(20) });

/**
 * Step 1 of the Magic-style checkout: phone number in, an OTP challenge out.
 * No account, no password — the phone number *is* the identity a repeat
 * checkout is recognised by.
 */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.res;

  try {
    const { challengeId, sent, devCode, expiresAt } = await requestOtp(parsed.data.phone);
    return NextResponse.json({ challengeId, sent, devCode, expiresAt });
  } catch (err) {
    if (err instanceof InvalidPhoneError) {
      return apiError(422, "invalid_phone", err.message);
    }
    throw err;
  }
}
