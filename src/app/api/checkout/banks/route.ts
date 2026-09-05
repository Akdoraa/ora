import { NextResponse, type NextRequest } from "next/server";
import { demoBankProvider } from "@/lib/bank-rails/demo-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bank picker options for the first-time bank-link step. */
export async function GET(req: NextRequest) {
  const country = req.nextUrl.searchParams.get("country") ?? "GB";
  const banks = await demoBankProvider.listBanks(country);
  return NextResponse.json({ banks });
}
