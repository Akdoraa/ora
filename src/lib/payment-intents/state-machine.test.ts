import { describe, it, expect } from "vitest";
import {
  transition,
  nextStatus,
  canTransition,
  isTerminal,
  isFailure,
  InvalidTransitionError,
  HAPPY_PATH,
  type PaymentStatus,
  type PaymentEvent,
} from "./state-machine";

describe("payment state machine", () => {
  it("walks the canonical happy path", () => {
    const steps: [PaymentStatus, PaymentEvent, PaymentStatus][] = [
      ["created", "route_discovery_started", "awaiting_route"],
      ["awaiting_route", "route_selected", "route_selected"],
      ["route_selected", "bank_authorization_requested", "awaiting_bank_authorization"],
      ["awaiting_bank_authorization", "bank_confirmed", "bank_confirmed"],
      ["bank_confirmed", "approval_required", "awaiting_agent_approval"],
      ["awaiting_agent_approval", "approval_granted", "x402_quote_paid"],
      ["x402_quote_paid", "settlement_started", "settling"],
      ["settling", "settlement_succeeded", "paid"],
      ["paid", "fulfilment_succeeded", "delivered"],
    ];
    for (const [from, event, to] of steps) {
      expect(transition(from, event).to).toBe(to);
    }
  });

  it("allows skipping approval when policy auto-approves", () => {
    expect(nextStatus("bank_confirmed", "x402_quote_paid")).toBe("x402_quote_paid");
  });

  it("rejects invalid transitions", () => {
    expect(() => nextStatus("created", "settlement_succeeded")).toThrow(
      InvalidTransitionError,
    );
    expect(() => nextStatus("paid", "bank_confirmed")).toThrow(InvalidTransitionError);
    expect(canTransition("delivered", "settlement_started")).toBe(false);
  });

  it("models failure + recovery for bank auth and settlement", () => {
    expect(nextStatus("awaiting_bank_authorization", "bank_authorization_failed")).toBe(
      "authorization_failed",
    );
    expect(nextStatus("authorization_failed", "retry_bank_authorization")).toBe(
      "awaiting_bank_authorization",
    );
    expect(nextStatus("settling", "settlement_failed")).toBe("settlement_failed");
    expect(nextStatus("settlement_failed", "retry_settlement")).toBe("settling");
  });

  it("models expiry, cancellation and refunds", () => {
    expect(nextStatus("awaiting_bank_authorization", "bank_authorization_expired")).toBe(
      "expired",
    );
    expect(nextStatus("awaiting_agent_approval", "approval_rejected")).toBe("cancelled");
    expect(nextStatus("delivered", "refunded")).toBe("refunded");
    expect(nextStatus("delivered", "partially_refunded")).toBe("partially_refunded");
    expect(nextStatus("partially_refunded", "refunded")).toBe("refunded");
  });

  it("classifies terminal and failure states", () => {
    expect(isTerminal("delivered")).toBe(true);
    expect(isTerminal("refunded")).toBe(true);
    expect(isTerminal("paid")).toBe(false);
    expect(isFailure("settlement_failed")).toBe(true);
    expect(isFailure("delivered")).toBe(false);
  });

  it("has no transitions out of hard-terminal states", () => {
    for (const s of ["cancelled", "expired", "refunded", "payment_failed"] as const) {
      expect(() => nextStatus(s, "settlement_started")).toThrow();
    }
  });

  it("HAPPY_PATH is ordered and reachable", () => {
    expect(HAPPY_PATH[0]).toBe("created");
    expect(HAPPY_PATH.at(-1)).toBe("delivered");
  });
});
