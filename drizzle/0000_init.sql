CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'awaiting_approval', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."bank_auth_status" AS ENUM('pending', 'confirmed', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."fulfilment_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_type" AS ENUM('funds_pending', 'settlement_liquidity', 'merchant_payable', 'processing_fee_revenue', 'fx_spread_revenue', 'refunds_payable', 'external_world');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_status" AS ENUM('created', 'awaiting_route', 'route_selected', 'awaiting_bank_authorization', 'bank_confirmed', 'awaiting_agent_approval', 'x402_quote_paid', 'settling', 'paid', 'delivered', 'authorization_failed', 'payment_failed', 'settlement_failed', 'fulfilment_failed', 'expired', 'cancelled', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank', 'qr', 'agent');--> statement-breakpoint
CREATE TYPE "public"."payment_origin" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."route_kind" AS ENUM('domestic_rail', 'xrpl_rlusd', 'card_network', 'swift_wire');--> statement-breakpoint
CREATE TYPE "public"."route_status" AS ENUM('candidate', 'qualified', 'rejected', 'selected');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('pending', 'settling', 'settled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."x402_status" AS ENUM('required', 'paying', 'paid', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."xrpl_tx_kind" AS ENUM('x402_payment', 'settlement', 'refund');--> statement-breakpoint
CREATE TYPE "public"."xrpl_tx_status" AS ENUM('created', 'submitted', 'validated', 'failed');--> statement-breakpoint
CREATE TABLE "agent_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"reason" text,
	"ok" boolean DEFAULT true NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_customer_id" text,
	"name" text NOT NULL,
	"max_payment_amount" bigint NOT NULL,
	"max_daily_spend_amount" bigint NOT NULL,
	"policy_currency" char(3) NOT NULL,
	"max_fx_spread_bps" integer DEFAULT 60 NOT NULL,
	"max_processing_fee_bps" integer DEFAULT 100 NOT NULL,
	"required_settlement_seconds" integer DEFAULT 60 NOT NULL,
	"auto_approve_under_amount" bigint NOT NULL,
	"approved_currencies" jsonb NOT NULL,
	"approved_merchant_ids" jsonb,
	"approved_providers" jsonb,
	"require_approval_for_new_payee" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"agent_policy_id" text,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"mode" text DEFAULT 'demo' NOT NULL,
	"model" text,
	"objective_text" text NOT NULL,
	"parsed_constraints" jsonb,
	"selected_route_id" text,
	"decision_summary" text,
	"token_usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_four" char(4) NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"agent_run_id" text,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"requested_amount" bigint NOT NULL,
	"requested_currency" char(3) NOT NULL,
	"policy_snapshot" jsonb,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text,
	"agent_run_id" text,
	"actor" text NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"provider" text DEFAULT 'ora_demo_bank' NOT NULL,
	"bank_id" text,
	"bank_name" text,
	"method" text DEFAULT 'bank' NOT NULL,
	"status" "bank_auth_status" DEFAULT 'pending' NOT NULL,
	"account_mask" text,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"authorization_reference" text,
	"qr_payload" text,
	"confirmed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"name" text,
	"country" char(2),
	"holding_currency" char(3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfilments" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"status" "fulfilment_status" DEFAULT 'pending' NOT NULL,
	"kind" text DEFAULT 'digital' NOT NULL,
	"deliverable" jsonb,
	"access_token" text,
	"delivered_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"merchant_id" text,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "ledger_account_type" NOT NULL,
	"scope_id" text,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_transaction_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"country" char(2) NOT NULL,
	"settlement_currency" char(3) NOT NULL,
	"statement_descriptor" text,
	"processing_fee_bps" integer DEFAULT 100 NOT NULL,
	"card_baseline_bps" integer DEFAULT 400 NOT NULL,
	"xrpl_payout_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"customer_id" text,
	"product_id" text,
	"status" "payment_intent_status" DEFAULT 'created' NOT NULL,
	"origin" "payment_origin" DEFAULT 'human' NOT NULL,
	"method" "payment_method" DEFAULT 'bank' NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"settlement_currency" char(3) NOT NULL,
	"settlement_amount" bigint,
	"processing_fee_amount" bigint,
	"merchant_net_amount" bigint,
	"fx_rate" text,
	"estimated_card_fee_amount" bigint,
	"savings_vs_card_amount" bigint,
	"selected_route_id" text,
	"agent_run_id" text,
	"agent_policy_id" text,
	"settlement_started_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"settlement_seconds" integer,
	"success_url" text,
	"cancel_url" text,
	"webhook_url" text,
	"metadata" jsonb,
	"failure_reason" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"kind" "route_kind" NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "route_status" DEFAULT 'candidate' NOT NULL,
	"processing_fee_bps" integer NOT NULL,
	"fx_spread_bps" integer NOT NULL,
	"total_cost_amount" bigint NOT NULL,
	"fx_rate" text NOT NULL,
	"quoted_settlement_amount" bigint NOT NULL,
	"estimated_seconds" integer NOT NULL,
	"reliability_bps" integer NOT NULL,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"rejection_reasons" jsonb,
	"score_explanation" text,
	"quote_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"kind" text DEFAULT 'digital' NOT NULL,
	"price_amount" bigint NOT NULL,
	"price_currency" char(3) NOT NULL,
	"deliverable" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"reason" text,
	"xrpl_transaction_id" text,
	"ledger_transaction_id" text,
	"idempotency_key" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"status" "settlement_status" DEFAULT 'pending' NOT NULL,
	"route_id" text,
	"gross_amount" bigint NOT NULL,
	"gross_currency" char(3) NOT NULL,
	"processing_fee_amount" bigint NOT NULL,
	"fx_spread_amount" bigint DEFAULT 0 NOT NULL,
	"net_amount" bigint NOT NULL,
	"net_currency" char(3) NOT NULL,
	"fx_rate" text,
	"xrpl_transaction_id" text,
	"reconciled_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'merchant' NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"payment_intent_id" text,
	"event_type" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature" text NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"enabled_events" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"agent_run_id" text,
	"resource_url" text NOT NULL,
	"invoice_id" text NOT NULL,
	"status" "x402_status" DEFAULT 'required' NOT NULL,
	"scheme" text DEFAULT 'exact' NOT NULL,
	"network" text NOT NULL,
	"asset" text NOT NULL,
	"issuer" text,
	"amount" text NOT NULL,
	"pay_to" text NOT NULL,
	"payment_requirements" jsonb,
	"xrpl_transaction_id" text,
	"facilitator_response" jsonb,
	"quote_payload" jsonb,
	"quote_signature" text,
	"quote_expires_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xrpl_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text,
	"kind" "xrpl_tx_kind" NOT NULL,
	"status" "xrpl_tx_status" DEFAULT 'created' NOT NULL,
	"network" text DEFAULT 'testnet' NOT NULL,
	"account" text NOT NULL,
	"destination" text NOT NULL,
	"amount_drops" text,
	"amount_value" text,
	"asset" text DEFAULT 'XRP' NOT NULL,
	"issuer" text,
	"source_tag" integer,
	"invoice_id" text,
	"memo" text,
	"tx_hash" text,
	"ledger_index" integer,
	"fee_drops" text,
	"engine_result" text,
	"validated" boolean DEFAULT false NOT NULL,
	"explorer_url" text,
	"last_ledger_sequence" integer,
	"submitted_at" timestamp with time zone,
	"validated_at" timestamp with time zone,
	"raw_result" jsonb,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_owner_customer_id_customers_id_fk" FOREIGN KEY ("owner_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_policy_id_agent_policies_id_fk" FOREIGN KEY ("agent_policy_id") REFERENCES "public"."agent_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_authorizations" ADD CONSTRAINT "bank_authorizations_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_routes" ADD CONSTRAINT "payment_routes_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_xrpl_transaction_id_xrpl_transactions_id_fk" FOREIGN KEY ("xrpl_transaction_id") REFERENCES "public"."xrpl_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_route_id_payment_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."payment_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_xrpl_transaction_id_xrpl_transactions_id_fk" FOREIGN KEY ("xrpl_transaction_id") REFERENCES "public"."xrpl_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xrpl_transactions" ADD CONSTRAINT "xrpl_transactions_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_decisions_run_idx" ON "agent_decisions" USING btree ("agent_run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_token_hash_uq" ON "api_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "audit_events_intent_idx" ON "audit_events" USING btree ("payment_intent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_uq" ON "idempotency_keys" USING btree ("scope","merchant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_uq" ON "ledger_accounts" USING btree ("type","scope_id","currency");--> statement-breakpoint
CREATE INDEX "ledger_entries_txn_idx" ON "ledger_entries" USING btree ("ledger_transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "payment_intents_merchant_idx" ON "payment_intents" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "payment_intents_status_idx" ON "payment_intents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_routes_intent_idx" ON "payment_routes" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_event_uq" ON "webhook_deliveries" USING btree ("endpoint_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xrpl_transactions_hash_uq" ON "xrpl_transactions" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "xrpl_transactions_intent_idx" ON "xrpl_transactions" USING btree ("payment_intent_id");