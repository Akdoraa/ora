import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { useTestDb, resetTestDb } from "@/test/db";
import { createPaymentIntent } from "@/test/fixtures";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/ids";

const approveAndContinue = vi.fn();
const rejectApproval = vi.fn();
vi.mock("@/lib/agent/runner", () => ({
  approveAndContinue: (...args: unknown[]) => approveAndContinue(...args),
  rejectApproval: (...args: unknown[]) => rejectApproval(...args),
}));

const { POST } = await import("./route");

function req(body: unknown) {
  return new NextRequest("http://localhost/api/payment-intents/x/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedPendingApproval(intentId: string) {
  const db = await getDb();
  const approvalId = newId("apr");
  await db.insert(schema.approvalRequests).values({
    id: approvalId,
    paymentIntentId: intentId,
    status: "pending",
    reason: "amount at/above the auto-approve threshold",
    requestedAmount: 425_000n,
    requestedCurrency: "GBP",
  });
  return approvalId;
}

beforeEach(async () => {
  resetTestDb();
  await useTestDb();
  approveAndContinue.mockReset();
  rejectApproval.mockReset();
  approveAndContinue.mockResolvedValue({ status: "delivered" });
});

describe("POST /api/payment-intents/:id/approve", () => {
  it("404s for an unknown intent", async () => {
    const res = await POST(req({ decision: "approve" }), ctx("pi_nope"));
    expect(res.status).toBe(404);
  });

  it("409s when the intent isn't awaiting approval", async () => {
    const { id } = await createPaymentIntent({ status: "created" });
    const res = await POST(req({ decision: "approve" }), ctx(id));
    expect(res.status).toBe(409);
    expect(approveAndContinue).not.toHaveBeenCalled();
  });

  it("409s when awaiting approval but no pending approval row exists", async () => {
    const { id } = await createPaymentIntent({ status: "awaiting_agent_approval" });
    const res = await POST(req({ decision: "approve" }), ctx(id));
    expect(res.status).toBe(409);
  });

  it("approves and continues the run", async () => {
    const { id } = await createPaymentIntent({ status: "awaiting_agent_approval" });
    const approvalId = await seedPendingApproval(id);
    const res = await POST(req({ decision: "approve", decidedBy: "Akdora" }), ctx(id));
    expect(res.status).toBe(200);
    expect(approveAndContinue).toHaveBeenCalledWith(id, approvalId, "Akdora");
  });

  it("returns 422 when the underlying run ends in failed", async () => {
    approveAndContinue.mockResolvedValueOnce({ status: "failed", error: "settlement failed" });
    const { id } = await createPaymentIntent({ status: "awaiting_agent_approval" });
    await seedPendingApproval(id);
    const res = await POST(req({ decision: "approve" }), ctx(id));
    expect(res.status).toBe(422);
  });

  it("rejects and cancels without touching approveAndContinue", async () => {
    const { id } = await createPaymentIntent({ status: "awaiting_agent_approval" });
    const approvalId = await seedPendingApproval(id);
    const res = await POST(req({ decision: "reject", decidedBy: "Akdora" }), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("cancelled");
    expect(rejectApproval).toHaveBeenCalledWith(id, approvalId, "Akdora");
    expect(approveAndContinue).not.toHaveBeenCalled();
  });

  it("uses a caller-supplied approvalId over the discovered pending one", async () => {
    const { id } = await createPaymentIntent({ status: "awaiting_agent_approval" });
    await seedPendingApproval(id);
    const res = await POST(req({ decision: "approve", approvalId: "apr_explicit" }), ctx(id));
    expect(res.status).toBe(200);
    expect(approveAndContinue).toHaveBeenCalledWith(id, "apr_explicit", "payer");
  });

  it("422s an invalid decision value", async () => {
    const { id } = await createPaymentIntent({ status: "awaiting_agent_approval" });
    await seedPendingApproval(id);
    const res = await POST(req({ decision: "maybe" }), ctx(id));
    expect(res.status).toBe(422);
  });

  it("does not act on an already-decided approval row", async () => {
    const { id } = await createPaymentIntent({ status: "awaiting_agent_approval" });
    const approvalId = await seedPendingApproval(id);
    const db = await getDb();
    await db
      .update(schema.approvalRequests)
      .set({ status: "approved" })
      .where(eq(schema.approvalRequests.id, approvalId));
    const res = await POST(req({ decision: "approve" }), ctx(id));
    expect(res.status).toBe(409);
    expect(approveAndContinue).not.toHaveBeenCalled();
  });
});
