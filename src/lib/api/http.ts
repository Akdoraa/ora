import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { z } from "zod";

export interface ApiError {
  error: string;
  message: string;
  detail?: unknown;
}

export function apiError(
  status: number,
  error: string,
  message: string,
  detail?: unknown,
): NextResponse<ApiError> {
  return NextResponse.json({ error, message, detail }, { status });
}

export async function parseBody<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { ok: false, res: apiError(400, "invalid_json", "request body is not valid JSON") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      res: apiError(422, "validation_error", "request failed validation", parsed.error.issues),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Authenticate a merchant by `Authorization: Bearer ora_sk_...`. */
export async function authMerchant(
  req: NextRequest,
): Promise<{ ok: true; merchantId: string; keyId: string } | { ok: false; res: NextResponse }> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, res: apiError(401, "unauthorized", "missing API key") };
  }
  const db = await getDb();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [key] = await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.tokenHash, tokenHash), sql`${schema.apiKeys.revokedAt} is null`))
    .limit(1);
  if (!key) return { ok: false, res: apiError(401, "unauthorized", "invalid API key") };
  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, key.id));
  return { ok: true, merchantId: key.merchantId, keyId: key.id };
}

/**
 * Idempotency-Key handling. Returns a cached response for a repeated key, or a
 * `commit` fn to store the fresh response.
 */
export async function withIdempotency(
  req: NextRequest,
  scope: string,
  merchantId: string | null,
  requestBody: unknown,
): Promise<
  | { replay: true; res: NextResponse }
  | { replay: false; commit: (status: number, body: unknown) => Promise<void> }
> {
  const key = req.headers.get("idempotency-key");
  if (!key) {
    return { replay: false, commit: async () => {} };
  }
  const db = await getDb();
  const requestHash = createHash("sha256")
    .update(JSON.stringify(requestBody ?? {}))
    .digest("hex");
  const [existing] = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.scope, scope),
        merchantId
          ? eq(schema.idempotencyKeys.merchantId, merchantId)
          : sql`${schema.idempotencyKeys.merchantId} is null`,
        eq(schema.idempotencyKeys.key, key),
      ),
    )
    .limit(1);

  if (existing?.completedAt) {
    if (existing.requestHash !== requestHash) {
      return {
        replay: true,
        res: apiError(422, "idempotency_conflict", "Idempotency-Key reused with a different body"),
      };
    }
    return {
      replay: true,
      res: NextResponse.json(existing.responseBody, { status: existing.responseStatus ?? 200 }),
    };
  }

  const id = existing?.id ?? `idem_${requestHash.slice(0, 24)}`;
  if (!existing) {
    await db
      .insert(schema.idempotencyKeys)
      .values({ id, scope, merchantId, key, requestHash, lockedAt: new Date() })
      .onConflictDoNothing();
  }
  return {
    replay: false,
    commit: async (status, body) => {
      await db
        .update(schema.idempotencyKeys)
        .set({ responseStatus: status, responseBody: body as Record<string, unknown>, completedAt: new Date() })
        .where(eq(schema.idempotencyKeys.id, id));
    },
  };
}
