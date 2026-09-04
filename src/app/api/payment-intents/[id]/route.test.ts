import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { createPaymentIntent } from "@/test/fixtures";
import { GET } from "./route";
import { GET as GET_STATUS } from "./status/route";
import { GET as GET_MANIFEST } from "./manifest/route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
const req = () => new NextRequest("http://localhost/x");

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
});

describe("GET /api/payment-intents/:id", () => {
  it("returns the full aggregate for an existing intent", async () => {
    const { id } = await createPaymentIntent();
    const res = await GET(req(), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intent.id).toBe(id);
  });

  it("404s for an unknown id", async () => {
    const res = await GET(req(), ctx("pi_nope"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/payment-intents/:id/status", () => {
  it("reports status, terminal flag, and an empty xrplTransactions list before settlement", async () => {
    const { id } = await createPaymentIntent({ status: "created" });
    const res = await GET_STATUS(req(), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("created");
    expect(body.terminal).toBe(false);
    expect(body.xrplTransactions).toEqual([]);
    expect(body.agentRun).toBeNull();
  });

  it("marks a terminal status correctly", async () => {
    const { id } = await createPaymentIntent({ status: "delivered" });
    const res = await GET_STATUS(req(), ctx(id));
    const body = await res.json();
    expect(body.terminal).toBe(true);
  });

  it("404s for an unknown id", async () => {
    const res = await GET_STATUS(req(), ctx("pi_nope"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/payment-intents/:id/manifest", () => {
  it("returns an agent-readable manifest with actionable URLs", async () => {
    const { id } = await createPaymentIntent({
      amount: 100_00n,
      currency: "GBP",
      description: "Annual software plan",
    });
    const res = await GET_MANIFEST(req(), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("payment_manifest");
    expect(body.paymentIntentId).toBe(id);
    expect(body.amount.minorUnits).toBe("10000");
    expect(body.amount.currency).toBe("GBP");
    expect(body.actions.run.url).toContain(`/api/payment-intents/${id}/run`);
    expect(body.actions.status.url).toContain(`/api/payment-intents/${id}/status`);
    expect(body.merchant.acceptsAgentPayments).toBe(true);
  });

  it("404s for an unknown id", async () => {
    const res = await GET_MANIFEST(req(), ctx("pi_nope"));
    expect(res.status).toBe(404);
  });
});
