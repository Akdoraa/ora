import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTestDb, resetTestDb } from "@/test/db";
import { createPaymentIntent, createAgentPolicy } from "@/test/fixtures";
import { NextRequest } from "next/server";

const runAgent = vi.fn();
vi.mock("@/lib/agent/runner", () => ({
  runAgent: (...args: unknown[]) => runAgent(...args),
}));

const { POST } = await import("./route");

function req(body: unknown) {
  return new NextRequest("http://localhost/api/payment-intents/x/run", {
    method: "POST",
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
  runAgent.mockReset();
  runAgent.mockResolvedValue({ status: "delivered" });
});

describe("POST /api/payment-intents/:id/run", () => {
  it("404s for an unknown intent", async () => {
    const res = await POST(req({ objective: "pay this invoice today" }), ctx("pi_nope"));
    expect(res.status).toBe(404);
  });

  it("409s when the intent isn't in status created", async () => {
    const { id } = await createPaymentIntent({ status: "paid" });
    const res = await POST(req({ objective: "pay this invoice today" }), ctx(id));
    expect(res.status).toBe(409);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("422s a too-short objective", async () => {
    const { id } = await createPaymentIntent({ status: "created" });
    const res = await POST(req({ objective: "hi" }), ctx(id));
    expect(res.status).toBe(422);
  });

  it("uses the intent's own agentPolicyId when none is given in the body", async () => {
    const { id: policyId } = await createAgentPolicy();
    const { id } = await createPaymentIntent({ status: "created", agentPolicyId: policyId });
    const res = await POST(req({ objective: "pay this invoice today" }), ctx(id));
    expect(res.status).toBe(200);
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ policyId }));
  });

  it("a body-supplied policyId overrides the intent's own", async () => {
    const { id: intentPolicy } = await createAgentPolicy({ id: "pol_on_intent" });
    const { id: bodyPolicy } = await createAgentPolicy({ id: "pol_from_body" });
    const { id } = await createPaymentIntent({ status: "created", agentPolicyId: intentPolicy });
    const res = await POST(req({ objective: "pay this invoice today", policyId: bodyPolicy }), ctx(id));
    expect(res.status).toBe(200);
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ policyId: bodyPolicy }));
  });

  it("regression: 422s instead of silently borrowing an unrelated policy when none is given", async () => {
    // an AgentPolicy exists in the DB (a different payer's), but this
    // intent has no agentPolicyId of its own and none was supplied — the
    // route must not fall back to "any row in the table"
    await createAgentPolicy({ id: "pol_belongs_to_someone_else" });
    const { id } = await createPaymentIntent({ status: "created", agentPolicyId: undefined });
    const res = await POST(req({ objective: "pay this invoice today" }), ctx(id));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("no_policy");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("maps a failed run to 422", async () => {
    runAgent.mockResolvedValueOnce({ status: "failed", error: "route discovery failed" });
    const { id: policyId } = await createAgentPolicy();
    const { id } = await createPaymentIntent({ status: "created", agentPolicyId: policyId });
    const res = await POST(req({ objective: "pay this invoice today" }), ctx(id));
    expect(res.status).toBe(422);
  });
});
