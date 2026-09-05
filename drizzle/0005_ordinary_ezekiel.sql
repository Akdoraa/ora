ALTER TABLE "customer_bank_links" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "otp_challenges" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "customer_bank_links" CASCADE;--> statement-breakpoint
DROP TABLE "otp_challenges" CASCADE;--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_phone_unique";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "phone";