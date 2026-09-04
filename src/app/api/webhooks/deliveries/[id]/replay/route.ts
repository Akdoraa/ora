import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { apiError } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { replayDelivery } from "@/lib/webhooks/emit";
import { currentMerchantId } from "@/lib/dashboard";

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

  // scope to the dashboard's own merchant — unlike the sibling
  // webhook-endpoints PATCH route, this had no ownership check at all, so
  // anyone who saw a delivery id could re-trigger a webhook to another
  // merchant's endpoint. replayDelivery only re-sends the already-signed,
  // already-sent payload to the endpoint on file (no data/secret exposure
  // and no money moves), but it's still someone else's endpoint traffic.
  const [endpoint] = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.id, existing.endpointId))
    .limit(1);
  if (!endpoint || endpoint.merchantId !== currentMerchantId()) {
    return apiError(404, "not_found", "delivery not found");
  }

  await replayDelivery(id);

  const [updated] = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.id, id))
    .limit(1);
  return NextResponse.json(jsonSafe(updated));
}
