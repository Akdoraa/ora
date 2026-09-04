import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { apiError } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { replayDelivery } from "@/lib/webhooks/emit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.id, id))
    .limit(1);
  if (!existing) return apiError(404, "not_found", "delivery not found");

  await replayDelivery(id);

  const [updated] = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.id, id))
    .limit(1);
  return NextResponse.json(jsonSafe(updated));
}
