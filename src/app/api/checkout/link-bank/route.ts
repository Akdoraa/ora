import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, apiError } from "@/lib/api/http";
import { linkBank } from "@/lib/identity/otp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  customerId: z.string().min(1),
  bankId: z.string().min(1),
  country: z.string().length(2).optional(),
});

/**
 * Step 3, first-time customers only: remember the chosen bank against this
 * identified customer so every future checkout skips this step entirely.
 */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.res;

  try {
    const link = await linkBank(
      parsed.data.customerId,
      parsed.data.bankId,
      parsed.data.country ?? "GB",
    );
    return NextResponse.json(link);
  } catch (err) {
    return apiError(422, "link_failed", err instanceof Error ? err.message : String(err));
  }
}
