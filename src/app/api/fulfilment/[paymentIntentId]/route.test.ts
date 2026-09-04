import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { createPaymentIntent } from "@/test/fixtures";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { GET, POST } from "./route";

function getReq(paymentIntentId: string, token?: string) {
  const url = new URL(`http://localhost/api/fulfilment/${paymentIntentId}`);
  if (token) url.searchParams.set("token", token);
  return new NextRequest(url);
}
function ctx(paymentIntentId: string) {
  return { params: Promise.resolve({ paymentIntentId }) };
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
});

describe("GET /api/fulfilment/:paymentIntentId", () => {
  it("403s with no token", async () => {
    const { id } = await createPaymentIntent();
    const res = await GET(getReq(id), ctx(id));
    expect(res.status).toBe(403);
  });

  it("403s with the wrong token", async () => {
    const { id } = await createPaymentIntent();
    const db = await getDb();
    await db.insert(schema.fulfilments).values({
      id: newId("ful"),
      paymentIntentId: id,
      status: "delivered",
      kind: "digital",
      deliverable: { kind: "digital", title: "Report" },
      accessToken: "REALTOKEN123",
      deliveredAt: new Date(),
    });
    const res = await GET(getReq(id, "WRONGTOKEN"), ctx(id));
    expect(res.status).toBe(403);
  });

  it("returns the deliverable with the correct token", async () => {
    const { id } = await createPaymentIntent();
    const db = await getDb();
    await db.insert(schema.fulfilments).values({
      id: newId("ful"),
      paymentIntentId: id,
      status: "delivered",
      kind: "digital",
      deliverable: { kind: "digital", title: "Report" },
      accessToken: "REALTOKEN123",
      deliveredAt: new Date(),
    });
    const res = await GET(getReq(id, "REALTOKEN123"), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Report");
  });
});

describe("POST /api/fulfilment/:paymentIntentId", () => {
  it("404s for an unknown intent", async () => {
    const res = await POST(getReq("pi_nope"), ctx("pi_nope"));
    expect(res.status).toBe(404);
  });

  it("409s when the intent isn't paid yet", async () => {
    const { id } = await createPaymentIntent({ status: "created" });
    const res = await POST(getReq(id), ctx(id));
    expect(res.status).toBe(409);
  });

  it("delivers fulfilment for a paid intent", async () => {
    const { id } = await createPaymentIntent({ status: "paid" });
    const res = await POST(getReq(id), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("delivered");
  });
});
