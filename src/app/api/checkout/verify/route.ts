import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, apiError } from "@/lib/api/http";
import { verifyOtp, OtpVerificationError } from "@/lib/identity/otp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ challengeId: z.string().min(1), code: z.string().min(4).max(8) });

/**
 * Step 2: verify the code. Reports back whether this phone already has a
 * bank on file — if so, the checkout can skip straight to "pay", exactly
 * like a returning Magic/card-on-file checkout.
 */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.res;

  try {
    const identity = await verifyOtp(parsed.data.challengeId, parsed.data.code);
    return NextResponse.json(identity);
  } catch (err) {
    if (err instanceof OtpVerificationError) {
      return apiError(401, "otp_invalid", err.message);
    }
    throw err;
  }
}
