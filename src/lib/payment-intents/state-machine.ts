/**
 * Explicit payment-intent state machine. Every status change in the system goes
 * through `transition()` — invalid moves throw, and each move names the event
 * that caused it so the audit trail reads cleanly.
 *
 * Canonical happy path (per the spec):
 *   created → awaiting_route → route_selected → awaiting_bank_authorization
 *   → bank_confirmed → awaiting_agent_approval → x402_quote_paid → settling
 *   → paid → delivered
 */

export const PAYMENT_STATUSES = [
  "created",
  "awaiting_route",
  "route_selected",
  "awaiting_bank_authorization",
  "bank_confirmed",
  "awaiting_agent_approval",
  "x402_quote_paid",
  "settling",
  "paid",
  "delivered",
  "authorization_failed",
  "payment_failed",
  "settlement_failed",
  "fulfilment_failed",
  "expired",
  "cancelled",
  "partially_refunded",
  "refunded",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_EVENTS = [
  "route_discovery_started",
  "route_selected",
  "bank_authorization_requested",
  "bank_confirmed",
  "bank_authorization_failed",
  "bank_authorization_expired",
  "approval_required",
  "approval_granted",
  "approval_rejected",
  "approval_expired",
  "x402_quote_paid",
  "settlement_started",
  "settlement_succeeded",
  "settlement_failed",
  "fulfilment_succeeded",
  "fulfilment_failed",
  "cancelled",
  "expired",
  "refunded",
  "partially_refunded",
  "retry_settlement",
  "retry_bank_authorization",
] as const;

export type PaymentEvent = (typeof PAYMENT_EVENTS)[number];

export const TERMINAL_STATUSES = new Set<PaymentStatus>([
  "delivered",
  "authorization_failed",
  "payment_failed",
  "settlement_failed",
  "fulfilment_failed",
  "expired",
  "cancelled",
  "refunded",
]);

export const FAILURE_STATUSES = new Set<PaymentStatus>([
  "authorization_failed",
  "payment_failed",
  "settlement_failed",
  "fulfilment_failed",
  "expired",
  "cancelled",
]);

type TransitionMap = {
  [S in PaymentStatus]?: {
    [E in PaymentEvent]?: PaymentStatus;
  };
};

export const TRANSITIONS: TransitionMap = {
  created: {
    route_discovery_started: "awaiting_route",
    route_selected: "route_selected",
    cancelled: "cancelled",
    expired: "expired",
  },
  awaiting_route: {
    route_selected: "route_selected",
    cancelled: "cancelled",
    expired: "expired",
  },
  route_selected: {
    bank_authorization_requested: "awaiting_bank_authorization",
    route_selected: "route_selected", // re-selection allowed before authorization
    cancelled: "cancelled",
    expired: "expired",
  },
  awaiting_bank_authorization: {
    bank_confirmed: "bank_confirmed",
    bank_authorization_failed: "authorization_failed",
    bank_authorization_expired: "expired",
    cancelled: "cancelled",
  },
  authorization_failed: {
    retry_bank_authorization: "awaiting_bank_authorization",
  },
  bank_confirmed: {
    approval_required: "awaiting_agent_approval",
    x402_quote_paid: "x402_quote_paid", // no approval needed
    cancelled: "cancelled",
  },
  awaiting_agent_approval: {
    approval_granted: "x402_quote_paid",
    approval_rejected: "cancelled",
    approval_expired: "expired",
    cancelled: "cancelled",
  },
  x402_quote_paid: {
    settlement_started: "settling",
    cancelled: "cancelled",
  },
  settling: {
    settlement_succeeded: "paid",
    settlement_failed: "settlement_failed",
  },
  settlement_failed: {
    retry_settlement: "settling",
  },
  paid: {
    fulfilment_succeeded: "delivered",
    fulfilment_failed: "fulfilment_failed",
    refunded: "refunded",
    partially_refunded: "partially_refunded",
  },
  fulfilment_failed: {
    fulfilment_succeeded: "delivered",
    refunded: "refunded",
  },
  delivered: {
    refunded: "refunded",
    partially_refunded: "partially_refunded",
  },
  partially_refunded: {
    refunded: "refunded",
    partially_refunded: "partially_refunded",
  },
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: PaymentStatus,
    public readonly event: PaymentEvent,
  ) {
    super(`Invalid payment transition: ${from} --(${event})--> ✗`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: PaymentStatus, event: PaymentEvent): boolean {
  return TRANSITIONS[from]?.[event] !== undefined;
}

export function nextStatus(from: PaymentStatus, event: PaymentEvent): PaymentStatus {
  const to = TRANSITIONS[from]?.[event];
  if (to === undefined) throw new InvalidTransitionError(from, event);
  return to;
}

export interface TransitionResult {
  from: PaymentStatus;
  to: PaymentStatus;
  event: PaymentEvent;
}

/** Compute a transition or throw. Callers persist `to` + write an audit event. */
export function transition(from: PaymentStatus, event: PaymentEvent): TransitionResult {
  return { from, to: nextStatus(from, event), event };
}

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isFailure(status: PaymentStatus): boolean {
  return FAILURE_STATUSES.has(status);
}

/** Ordered list of the happy-path statuses, for progress UIs. */
export const HAPPY_PATH: PaymentStatus[] = [
  "created",
  "route_selected",
  "awaiting_bank_authorization",
  "bank_confirmed",
  "awaiting_agent_approval",
  "x402_quote_paid",
  "settling",
  "paid",
  "delivered",
];
