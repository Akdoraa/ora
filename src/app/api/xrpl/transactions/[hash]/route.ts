import { NextResponse, type NextRequest } from "next/server";
import { verifyTransactionByHash } from "@/lib/xrpl/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ hash: string }> },
) {
  const { hash } = await ctx.params;
  if (!/^[0-9A-Fa-f]{64}$/.test(hash)) {
    return NextResponse.json(
      { error: "invalid_hash", message: "expected a 64-char hex transaction hash" },
      { status: 400 },
    );
  }
  const verification = await verifyTransactionByHash(hash.toUpperCase());
  return NextResponse.json(verification, { status: verification.found ? 200 : 404 });
}
