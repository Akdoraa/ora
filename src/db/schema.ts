/**
 * Ora domain schema (Drizzle / PostgreSQL dialect — runs on PGlite locally and
 * real Postgres in prod).
 *
 * Money is ALWAYS stored as integer minor units (`bigint`, JS `bigint` mode)
 * plus an ISO-4217 currency code. Never a float, never a Postgres `numeric`
 * for amounts that must be exact to the minor unit.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ─── shared column helpers ──────────────────────────────────────────────── */

const id = (name = "id") => text(name).primaryKey();
const money = (name: string) => bigint(name, { mode: "bigint" });
const currency = (name = "currency") => char(name, { length: 3 });
const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

/* ─── enums ──────────────────────────────────────────────────────────────── */

export const paymentIntentStatus = pgEnum("payment_intent_status", [
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
  // failure / terminal
  "authorization_failed",
  "payment_failed",
  "settlement_failed",
  "fulfilment_failed",
  "expired",
  "cancelled",
  "partially_refunded",
  "refunded",
]);

export const paymentOrigin = pgEnum("payment_origin", ["human", "agent"]);
export const paymentMethod = pgEnum("payment_method", ["bank", "qr", "agent"]);

export const routeStatus = pgEnum("route_status", [
  "candidate",
  "qualified",
  "rejected",
  "selected",
]);
export const routeKind = pgEnum("route_kind", [
  "xrpl_rlusd",
  "xrpl_amm",
  "xrpl_orderbook",
  "xrpl_combined",
]);

export const bankAuthStatus = pgEnum("bank_auth_status", [
  "pending",
  "confirmed",
  "failed",
  "expired",
  "cancelled",
]);

export const agentRunStatus = pgEnum("agent_run_status", [
  "running",
  "awaiting_approval",
  "completed",
  "failed",
]);

export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
]);

export const x402Status = pgEnum("x402_status", [
  "required",
  "paying",
  "paid",
  "verified",
  "failed",
]);

export const xrplTxKind = pgEnum("xrpl_tx_kind", [
  "x402_payment",
  "settlement",
  "refund",
]);
export const xrplTxStatus = pgEnum("xrpl_tx_status", [
  "created",
  "submitted",
  "validated",
  "failed",
]);

export const settlementStatus = pgEnum("settlement_status", [
  "pending",
  "settling",
  "settled",
  "failed",
]);

export const ledgerAccountType = pgEnum("ledger_account_type", [
  "funds_pending",
  "settlement_liquidity",
  "merchant_payable",
  "processing_fee_revenue",
  "fx_spread_revenue",
  "refunds_payable",
  "external_world",
]);

export const refundStatus = pgEnum("refund_status", [
  "pending",
  "processing",
  "succeeded",
  "failed",
]);

export const fulfilmentStatus = pgEnum("fulfilment_status", [
  "pending",
  "delivered",
  "failed",
]);

export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
  "retrying",
]);

/* ─── identity & merchant ────────────────────────────────────────────────── */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("merchant"), // merchant | admin
  passwordHash: text("password_hash"),
  createdAt,
});

export const merchants = pgTable("merchants", {
  id: id(),
  ownerUserId: text("owner_user_id").references(() => users.id),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  country: char("country", { length: 2 }).notNull(),
  settlementCurrency: currency("settlement_currency").notNull(),
  statementDescriptor: text("statement_descriptor"),
  // % the merchant pays Ora, in basis points (100 = 1.00%)
  processingFeeBps: integer("processing_fee_bps").notNull().default(100),
  // baseline card cost we compare savings against, basis points
  cardBaselineBps: integer("card_baseline_bps").notNull().default(400),
  xrplPayoutAddress: text("xrpl_payout_address"),
  createdAt,
  updatedAt,
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // e.g. "ora_sk_test_ab12"
    tokenHash: text("token_hash").notNull(),
    lastFour: char("last_four", { length: 4 }).notNull(),
    livemode: boolean("livemode").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [uniqueIndex("api_keys_token_hash_uq").on(t.tokenHash)],
);

export const products = pgTable("products", {
  id: id(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  kind: text("kind").notNull().default("digital"), // digital | license | report | api_credits | booking
  priceAmount: money("price_amount").notNull(),
  priceCurrency: currency("price_currency").notNull(),
  // what fulfilment unlocks
  deliverable: jsonb("deliverable").$type<Record<string, unknown>>(),
  createdAt,
});

export const customers = pgTable("customers", {
  id: id(),
  email: text("email"),
  name: text("name"),
  country: char("country", { length: 2 }),
  holdingCurrency: currency("holding_currency"),
  createdAt,
});

/* ─── payment intent (state machine root) ────────────────────────────────── */

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: id(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    customerId: text("customer_id").references(() => customers.id),
    productId: text("product_id").references(() => products.id),

    status: paymentIntentStatus("status").notNull().default("created"),
    origin: paymentOrigin("origin").notNull().default("human"),
    method: paymentMethod("method").notNull().default("bank"),

    description: text("description").notNull(),
    reference: text("reference"), // merchant invoice ref, e.g. INV-4471

    // amount the customer is charged, in their presentment currency
    amount: money("amount").notNull(),
    currency: currency("currency").notNull(),

    // currency the merchant wants to receive
    settlementCurrency: currency("settlement_currency").notNull(),

    // computed once a route + FX quote are locked (settlement currency minor units)
    settlementAmount: money("settlement_amount"),
    processingFeeAmount: money("processing_fee_amount"),
    merchantNetAmount: money("merchant_net_amount"),
    fxRate: text("fx_rate"), // decimal string, presentment->settlement
    estimatedCardFeeAmount: money("estimated_card_fee_amount"),
    savingsVsCardAmount: money("savings_vs_card_amount"),

    selectedRouteId: text("selected_route_id"),
    agentRunId: text("agent_run_id"),
    agentPolicyId: text("agent_policy_id"),

    settlementStartedAt: timestamp("settlement_started_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settlementSeconds: integer("settlement_seconds"),

    successUrl: text("success_url"),
    cancelUrl: text("cancel_url"),
    webhookUrl: text("webhook_url"),

    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    failureReason: text("failure_reason"),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("payment_intents_merchant_idx").on(t.merchantId),
    index("payment_intents_status_idx").on(t.status),
  ],
);

/* ─── routes & quotes ───────────────────────────────────────────────────── */

export const paymentRoutes = pgTable(
  "payment_routes",
  {
    id: id(),
    paymentIntentId: text("payment_intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    kind: routeKind("kind").notNull(),
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    status: routeStatus("status").notNull().default("candidate"),

    // quote — all amounts in the intent's presentment currency minor units
    processingFeeBps: integer("processing_fee_bps").notNull(),
    fxSpreadBps: integer("fx_spread_bps").notNull(),
    totalCostAmount: money("total_cost_amount").notNull(),
    fxRate: text("fx_rate").notNull(), // decimal string
    quotedSettlementAmount: money("quoted_settlement_amount").notNull(),
    estimatedSeconds: integer("estimated_seconds").notNull(),
    reliabilityBps: integer("reliability_bps").notNull(), // 9920 = 99.20%

    isSynthetic: boolean("is_synthetic").notNull().default(true),
    rejectionReasons: jsonb("rejection_reasons").$type<string[]>(),
    scoreExplanation: text("score_explanation"),
    quoteExpiresAt: timestamp("quote_expires_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [index("payment_routes_intent_idx").on(t.paymentIntentId)],
);

/* ─── bank authorization ────────────────────────────────────────────────── */

export const bankAuthorizations = pgTable("bank_authorizations", {
  id: id(),
  paymentIntentId: text("payment_intent_id")
    .notNull()
    .references(() => paymentIntents.id),
  provider: text("provider").notNull().default("ora_demo_bank"),
  bankId: text("bank_id"),
  bankName: text("bank_name"),
  method: text("method").notNull().default("bank"), // bank | qr
  status: bankAuthStatus("status").notNull().default("pending"),
  // masked account ref only — NEVER raw credentials
  accountMask: text("account_mask"),
  amount: money("amount").notNull(),
  currency: currency("currency").notNull(),
  authorizationReference: text("authorization_reference"),
  qrPayload: text("qr_payload"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdAt,
  updatedAt,
});

/* ─── agent: policy, run, decisions, approvals ──────────────────────────── */

export const agentPolicies = pgTable("agent_policies", {
  id: id(),
  ownerCustomerId: text("owner_customer_id").references(() => customers.id),
  name: text("name").notNull(),
  maxPaymentAmount: money("max_payment_amount").notNull(),
  maxDailySpendAmount: money("max_daily_spend_amount").notNull(),
  policyCurrency: currency("policy_currency").notNull(),
  maxFxSpreadBps: integer("max_fx_spread_bps").notNull().default(60),
  maxProcessingFeeBps: integer("max_processing_fee_bps").notNull().default(100),
  requiredSettlementSeconds: integer("required_settlement_seconds").notNull().default(60),
  autoApproveUnderAmount: money("auto_approve_under_amount").notNull(),
  approvedCurrencies: jsonb("approved_currencies").$type<string[]>().notNull(),
  approvedMerchantIds: jsonb("approved_merchant_ids").$type<string[]>(),
  approvedProviders: jsonb("approved_providers").$type<string[]>(),
  requireApprovalForNewPayee: boolean("require_approval_for_new_payee")
    .notNull()
    .default(true),
  createdAt,
  updatedAt,
});

export const agentRuns = pgTable("agent_runs", {
  id: id(),
  paymentIntentId: text("payment_intent_id")
    .notNull()
    .references(() => paymentIntents.id),
  agentPolicyId: text("agent_policy_id").references(() => agentPolicies.id),
  status: agentRunStatus("status").notNull().default("running"),
  mode: text("mode").notNull().default("demo"), // live | demo
  model: text("model"),
  objectiveText: text("objective_text").notNull(),
  parsedConstraints: jsonb("parsed_constraints").$type<Record<string, unknown>>(),
  selectedRouteId: text("selected_route_id"),
  decisionSummary: text("decision_summary"),
  tokenUsage: jsonb("token_usage").$type<Record<string, number>>(),
  startedAt: createdAt,
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
});

export const agentDecisions = pgTable(
  "agent_decisions",
  {
    id: id(),
    agentRunId: text("agent_run_id")
      .notNull()
      .references(() => agentRuns.id),
    seq: integer("seq").notNull(),
    tool: text("tool").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    reason: text("reason"),
    ok: boolean("ok").notNull().default(true),
    durationMs: integer("duration_ms"),
    createdAt,
  },
  (t) => [index("agent_decisions_run_idx").on(t.agentRunId, t.seq)],
);

export const approvalRequests = pgTable("approval_requests", {
  id: id(),
  paymentIntentId: text("payment_intent_id")
    .notNull()
    .references(() => paymentIntents.id),
  agentRunId: text("agent_run_id").references(() => agentRuns.id),
  status: approvalStatus("status").notNull().default("pending"),
  reason: text("reason").notNull(),
  requestedAmount: money("requested_amount").notNull(),
  requestedCurrency: currency("requested_currency").notNull(),
  policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt,
});

/* ─── x402 & XRPL ───────────────────────────────────────────────────────── */

export const x402Payments = pgTable("x402_payments", {
  id: id(),
  paymentIntentId: text("payment_intent_id")
    .notNull()
    .references(() => paymentIntents.id),
  agentRunId: text("agent_run_id").references(() => agentRuns.id),
  resourceUrl: text("resource_url").notNull(),
  invoiceId: text("invoice_id").notNull(),
  status: x402Status("status").notNull().default("required"),
  scheme: text("scheme").notNull().default("exact"),
  network: text("network").notNull(), // xrpl:1 (testnet)
  asset: text("asset").notNull(), // "XRP" or RLUSD hex
  issuer: text("issuer"),
  amount: text("amount").notNull(), // drops (XRP) or decimal string (IOU)
  payTo: text("pay_to").notNull(),
  paymentRequirements: jsonb("payment_requirements").$type<Record<string, unknown>>(),
  xrplTransactionId: text("xrpl_transaction_id"),
  facilitatorResponse: jsonb("facilitator_response").$type<Record<string, unknown>>(),
  quotePayload: jsonb("quote_payload").$type<Record<string, unknown>>(),
  quoteSignature: text("quote_signature"),
  quoteExpiresAt: timestamp("quote_expires_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdAt,
  updatedAt,
});

export const xrplTransactions = pgTable(
  "xrpl_transactions",
  {
    id: id(),
    paymentIntentId: text("payment_intent_id").references(() => paymentIntents.id),
    kind: xrplTxKind("kind").notNull(),
    status: xrplTxStatus("status").notNull().default("created"),
    network: text("network").notNull().default("testnet"),
    account: text("account").notNull(), // sender r-address
    destination: text("destination").notNull(),
    amountDrops: text("amount_drops"), // when XRP
    amountValue: text("amount_value"), // when IOU
    asset: text("asset").notNull().default("XRP"),
    issuer: text("issuer"),
    sourceTag: integer("source_tag"),
    invoiceId: text("invoice_id"),
    memo: text("memo"),
    txHash: text("tx_hash"),
    ledgerIndex: integer("ledger_index"),
    feeDrops: text("fee_drops"),
    engineResult: text("engine_result"), // tesSUCCESS etc.
    validated: boolean("validated").notNull().default(false),
    explorerUrl: text("explorer_url"),
    lastLedgerSequence: integer("last_ledger_sequence"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    rawResult: jsonb("raw_result").$type<Record<string, unknown>>(),
    failureReason: text("failure_reason"),
    attempts: integer("attempts").notNull().default(0),
    createdAt,
  },
  (t) => [
    uniqueIndex("xrpl_transactions_hash_uq").on(t.txHash),
    index("xrpl_transactions_intent_idx").on(t.paymentIntentId),
  ],
);

/* ─── settlement ───────────────────────────────────────────────────────── */

export const settlements = pgTable("settlements", {
  id: id(),
  paymentIntentId: text("payment_intent_id")
    .notNull()
    .references(() => paymentIntents.id),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  status: settlementStatus("status").notNull().default("pending"),
  routeId: text("route_id").references(() => paymentRoutes.id),
  grossAmount: money("gross_amount").notNull(),
  grossCurrency: currency("gross_currency").notNull(),
  processingFeeAmount: money("processing_fee_amount").notNull(),
  fxSpreadAmount: money("fx_spread_amount").notNull().default(sql`0`),
  netAmount: money("net_amount").notNull(),
  netCurrency: currency("net_currency").notNull(),
  fxRate: text("fx_rate"),
  xrplTransactionId: text("xrpl_transaction_id").references(() => xrplTransactions.id),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt,
});

/* ─── double-entry ledger ──────────────────────────────────────────────── */

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: id(),
    type: ledgerAccountType("type").notNull(),
    scopeId: text("scope_id"), // e.g. merchant id for merchant_payable
    currency: currency("currency").notNull(),
    createdAt,
  },
  (t) => [
    uniqueIndex("ledger_accounts_uq").on(t.type, t.scopeId, t.currency),
  ],
);

export const ledgerTransactions = pgTable("ledger_transactions", {
  id: id(),
  paymentIntentId: text("payment_intent_id").references(() => paymentIntents.id),
  kind: text("kind").notNull(), // capture | settle | fee | fx | refund | reversal
  reason: text("reason").notNull(),
  idempotencyKey: text("idempotency_key"),
  createdAt,
});

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    ledgerTransactionId: text("ledger_transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id),
    // signed minor units: positive = credit, negative = debit. Sum per txn = 0.
    amount: money("amount").notNull(),
    currency: currency("currency").notNull(),
    createdAt,
  },
  (t) => [
    index("ledger_entries_txn_idx").on(t.ledgerTransactionId),
    index("ledger_entries_account_idx").on(t.accountId),
  ],
);

/* ─── refunds & fulfilment ─────────────────────────────────────────────── */

export const refunds = pgTable("refunds", {
  id: id(),
  paymentIntentId: text("payment_intent_id")
    .notNull()
    .references(() => paymentIntents.id),
  status: refundStatus("status").notNull().default("pending"),
  amount: money("amount").notNull(),
  currency: currency("currency").notNull(),
  reason: text("reason"),
  xrplTransactionId: text("xrpl_transaction_id").references(() => xrplTransactions.id),
  ledgerTransactionId: text("ledger_transaction_id").references(
    () => ledgerTransactions.id,
  ),
  idempotencyKey: text("idempotency_key"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt,
});

export const fulfilments = pgTable("fulfilments", {
  id: id(),
  paymentIntentId: text("payment_intent_id")
    .notNull()
    .references(() => paymentIntents.id),
  status: fulfilmentStatus("status").notNull().default("pending"),
  kind: text("kind").notNull().default("digital"),
  deliverable: jsonb("deliverable").$type<Record<string, unknown>>(),
  accessToken: text("access_token"), // one-time token to fetch the deliverable
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdAt,
});

/* ─── webhooks ─────────────────────────────────────────────────────────── */

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: id(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  enabledEvents: jsonb("enabled_events").$type<string[]>().notNull(),
  active: boolean("active").notNull().default(true),
  // "merchant": a real, standing subscription (dashboard-managed) that
  // receives every event for the merchant. "intent": a one-off destination
  // created from a single Payment Intent's `webhookUrl` — must never be
  // treated as a merchant-wide subscriber to *other* intents' events.
  scope: text("scope").notNull().default("merchant"),
  createdAt,
});

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id),
    paymentIntentId: text("payment_intent_id").references(() => paymentIntents.id),
    eventType: text("event_type").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    signature: text("signature").notNull(),
    status: webhookDeliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index("webhook_deliveries_endpoint_idx").on(t.endpointId),
    uniqueIndex("webhook_deliveries_event_uq").on(t.endpointId, t.eventId),
  ],
);

/* ─── audit & idempotency ─────────────────────────────────────────────── */

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    paymentIntentId: text("payment_intent_id").references(() => paymentIntents.id),
    agentRunId: text("agent_run_id").references(() => agentRuns.id),
    actor: text("actor").notNull(), // system | agent | merchant:<id> | customer | admin:<id>
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt,
  },
  (t) => [index("audit_events_intent_idx").on(t.paymentIntentId, t.createdAt)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: id(),
    scope: text("scope").notNull(), // e.g. "POST /api/payment-intents"
    merchantId: text("merchant_id"),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [uniqueIndex("idempotency_keys_uq").on(t.scope, t.merchantId, t.key)],
);

/* ─── inferred types ──────────────────────────────────────────────────── */

export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type NewPaymentIntent = typeof paymentIntents.$inferInsert;
export type PaymentRoute = typeof paymentRoutes.$inferSelect;
export type Merchant = typeof merchants.$inferSelect;
export type AgentPolicy = typeof agentPolicies.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type AgentDecision = typeof agentDecisions.$inferSelect;
export type X402Payment = typeof x402Payments.$inferSelect;
export type XrplTransaction = typeof xrplTransactions.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type Fulfilment = typeof fulfilments.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type BankAuthorization = typeof bankAuthorizations.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
