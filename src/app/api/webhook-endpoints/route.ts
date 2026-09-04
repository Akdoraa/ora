import { NextResponse, type NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { parseBody, apiError } from "@/lib/api/http";
import { jsonSafe } from "@/lib/api/serialize";
import { currentMerchantId } from "@/lib/dashboard";
import { recordAuditEvent } from "@/lib/audit/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(
      and(
        eq(schema.webhookEndpoints.merchantId, currentMerchantId()),
        eq(schema.webhookEndpoints.scope, "merchant"),
      ),
    );
  // never return the signing secret over the wire
  return NextResponse.json(jsonSafe(rows.map(({ secret: _secret, ...r }) => r)));
}

const CreateSchema = z.object({
  url: z.string().url(),
  enabledEvents: z.array(z.string()).default(["*"]),
});

/** Dashboard-only: register a new webhook endpoint for the demo merchant. */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.ok) return parsed.res;
  if (!parsed.data.url.startsWith("https://") && !parsed.data.url.includes("localhost")) {
    return apiError(422, "invalid_url", "webhook URLs must be https:// (localhost allowed for demo)");
  }

  const db = await getDb();
  const id = newId("whe");
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const [row] = await db
    .insert(schema.webhookEndpoints)
    .values({
      id,
      merchantId: currentMerchantId(),
      url: parsed.data.url,
      secret,
      enabledEvents: parsed.data.enabledEvents ?? ["*"],
      active: true,
      scope: "merchant",
    })
    .returning();

  await recordAuditEvent({
    actor: `merchant:${currentMerchantId()}`,
    type: "webhook_endpoint.created",
    summary: `webhook endpoint registered: ${parsed.data.url}`,
  });

  // the signing secret is shown once, on creation, like a real API platform
  return NextResponse.json(jsonSafe({ ...row, secret }), { status: 201 });
}
