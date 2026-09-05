ALTER TABLE "payment_routes" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."route_kind";--> statement-breakpoint
CREATE TYPE "public"."route_kind" AS ENUM('xrpl_rlusd', 'xrpl_amm', 'xrpl_orderbook');--> statement-breakpoint
ALTER TABLE "payment_routes" ALTER COLUMN "kind" SET DATA TYPE "public"."route_kind" USING "kind"::"public"."route_kind";