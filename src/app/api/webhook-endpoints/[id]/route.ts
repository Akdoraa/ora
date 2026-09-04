import { NextResponse, type NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { parseBody, apiError } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { currentMerchantId } from "@/lib/dashboard";
import { recordAuditEvent } from "@/lib/audit/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  url: z.string().url().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(
      and(
        eq(schema.webhookEndpoints.id, id),
        eq(schema.webhookEndpoints.merchantId, currentMerchantId()),
      ),
    )
    .limit(1);
  if (!existing) return apiError(404, "not_found", "webhook endpoint not found");

  const parsed = await parseBody(req, PatchSchema);
  if (!parsed.ok) return parsed.res;
  if (Object.keys(parsed.data).length === 0) {
    return apiError(422, "no_changes", "no recognised fields in the request body");
  }

  const [updated] = await db
    .update(schema.webhookEndpoints)
    .set(parsed.data)
    .where(eq(schema.webhookEndpoints.id, id))
    .returning();

  await recordAuditEvent({
    actor: `merchant:${currentMerchantId()}`,
    type: "webhook_endpoint.updated",
    summary: `webhook endpoint ${id} updated`,
    data: { fields: Object.keys(parsed.data) },
  });

  const { secret: _secret, ...safe } = updated!;
  return NextResponse.json(jsonSafe(safe));
}
