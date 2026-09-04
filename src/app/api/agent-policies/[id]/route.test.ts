import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { createAgentPolicy } from "@/test/fixtures";
import { GET, PATCH } from "./route";

function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/agent-policies/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
});

describe("GET /api/agent-policies/:id", () => {
  it("returns the policy", async () => {
    const { id } = await createAgentPolicy();
    const res = await GET(new NextRequest("http://localhost/x"), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
  });

  it("404s for an unknown id", async () => {
    const res = await GET(new NextRequest("http://localhost/x"), ctx("pol_nope"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/agent-policies/:id", () => {
  it("updates recognised fields and records an audit event", async () => {
    const { id } = await createAgentPolicy({ maxPaymentAmount: 400_000n });
    const res = await PATCH(patchReq({ maxProcessingFeeBps: 150 }), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxProcessingFeeBps).toBe(150);
  });

  it("404s for an unknown id", async () => {
    const res = await PATCH(patchReq({ maxProcessingFeeBps: 150 }), ctx("pol_nope"));
    expect(res.status).toBe(404);
  });

  it("422s when the body has no recognised fields", async () => {
    const { id } = await createAgentPolicy();
    const res = await PATCH(patchReq({ notARealField: 1 }), ctx(id));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("no_changes");
  });

  it("rejects an auto-approve threshold above the max-per-payment cap", async () => {
    const { id } = await createAgentPolicy({
      maxPaymentAmount: 400_000n,
      autoApproveUnderAmount: 100_000n,
    });
    const res = await PATCH(patchReq({ autoApproveUnderAmountMajor: 5_000 }), ctx(id));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid_policy");
    expect(body.message).toMatch(/auto-approve/);
  });

  it("accepts an auto-approve threshold raised together with a higher cap in the same request", async () => {
    const { id } = await createAgentPolicy({
      maxPaymentAmount: 400_000n,
      autoApproveUnderAmount: 100_000n,
    });
    const res = await PATCH(
      patchReq({ maxPaymentAmountMajor: 6_000, autoApproveUnderAmountMajor: 5_500 }),
      ctx(id),
    );
    expect(res.status).toBe(200);
  });

  it("rejects lowering the per-payment cap below the existing auto-approve threshold", async () => {
    const { id } = await createAgentPolicy({
      maxPaymentAmount: 400_000n,
      autoApproveUnderAmount: 100_000n,
    });
    // only touching maxPaymentAmount — must still be compared against the
    // *existing* autoApproveUnderAmount, not just fields present in this body
    const res = await PATCH(patchReq({ maxPaymentAmountMajor: 500 }), ctx(id));
    expect(res.status).toBe(422);
  });

  it("rejects a daily cap lower than the max-per-payment cap", async () => {
    const { id } = await createAgentPolicy({
      maxPaymentAmount: 400_000n,
      maxDailySpendAmount: 1_000_000n,
    });
    const res = await PATCH(patchReq({ maxDailySpendAmountMajor: 1_000 }), ctx(id));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid_policy");
    expect(body.message).toMatch(/daily/);
  });

  it("rejects raising the per-payment cap above the existing daily cap", async () => {
    const { id } = await createAgentPolicy({
      maxPaymentAmount: 400_000n,
      maxDailySpendAmount: 1_000_000n,
    });
    const res = await PATCH(patchReq({ maxPaymentAmountMajor: 20_000 }), ctx(id));
    expect(res.status).toBe(422);
  });
});
