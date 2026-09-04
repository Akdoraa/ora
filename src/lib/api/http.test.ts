import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { withIdempotency } from "./http";

function reqWithKey(key?: string) {
  return new NextRequest("http://localhost/api/test", {
    method: "POST",
    headers: key ? { "idempotency-key": key } : {},
  });
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
});

describe("withIdempotency", () => {
  it("passes through (no caching) when no Idempotency-Key header is sent", async () => {
    const result = await withIdempotency(reqWithKey(), "POST /test", "mrc_1", { a: 1 });
    expect(result.replay).toBe(false);
  });

  it("the first request with a key is not a replay and can commit a response", async () => {
    const result = await withIdempotency(reqWithKey("key-1"), "POST /test", "mrc_1", { a: 1 });
    expect(result.replay).toBe(false);
    if (!result.replay) {
      await result.commit(201, { id: "created-1" });
    }
  });

  it("a second request with the same key + same body replays the cached response", async () => {
    const body = { amount: 100 };
    const first = await withIdempotency(reqWithKey("key-2"), "POST /test", "mrc_1", body);
    if (!first.replay) await first.commit(201, { id: "created-2" });

    const second = await withIdempotency(reqWithKey("key-2"), "POST /test", "mrc_1", body);
    expect(second.replay).toBe(true);
    if (second.replay) {
      expect(second.res.status).toBe(201);
      const json = await second.res.json();
      expect(json).toEqual({ id: "created-2" });
    }
  });

  it("a second request with the same key but a DIFFERENT body is rejected as a conflict", async () => {
    const first = await withIdempotency(reqWithKey("key-3"), "POST /test", "mrc_1", { a: 1 });
    if (!first.replay) await first.commit(201, { id: "created-3" });

    const second = await withIdempotency(reqWithKey("key-3"), "POST /test", "mrc_1", { a: 2 });
    expect(second.replay).toBe(true);
    if (second.replay) {
      expect(second.res.status).toBe(422);
      const json = await second.res.json();
      expect(json.error).toBe("idempotency_conflict");
    }
  });

  it("the same key is independent per merchant", async () => {
    const body = { a: 1 };
    const forMerchantA = await withIdempotency(reqWithKey("shared-key"), "POST /test", "mrc_a", body);
    if (!forMerchantA.replay) await forMerchantA.commit(201, { id: "a-owns-this" });

    const forMerchantB = await withIdempotency(reqWithKey("shared-key"), "POST /test", "mrc_b", body);
    // different merchant scope -> not a replay of merchant A's result
    expect(forMerchantB.replay).toBe(false);
  });

  it("an uncommitted key (request never finished) does not replay a stale response", async () => {
    // simulates a request that started (row locked) but crashed before commit()
    await withIdempotency(reqWithKey("key-4"), "POST /test", "mrc_1", { a: 1 });
    const retry = await withIdempotency(reqWithKey("key-4"), "POST /test", "mrc_1", { a: 1 });
    // no completed response cached yet, so this must not replay a fake result
    expect(retry.replay).toBe(false);
  });
});
