import { redirect } from "next/navigation";
import { eq, and, desc } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { seedId } from "@/lib/ids";
import { createPaymentIntent } from "@/lib/payment-intents/service";
import { env } from "@/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click demo launcher: spins up a fresh seeded UK→Singapore payment intent
 * and drops the judge straight onto the hosted checkout. `/demo?fresh=1` always
 * makes a new one; otherwise a still-open one is reused.
 */
export default async function DemoLauncher({
  searchParams,
}: {
  searchParams: Promise<{ fresh?: string }>;
}) {
  const { fresh } = await searchParams;
  const db = await getDb();
  const merchantId = seedId("mrc", "marina");

  const merchant = (
    await db.select().from(schema.merchants).where(eq(schema.merchants.id, merchantId)).limit(1)
  )[0];
  if (!merchant) {
    redirect("/?error=not-seeded");
  }

  if (!fresh) {
    const [open] = await db
      .select()
      .from(schema.paymentIntents)
      .where(
        and(
          eq(schema.paymentIntents.merchantId, merchantId),
          eq(schema.paymentIntents.status, "created"),
        ),
      )
      .orderBy(desc(schema.paymentIntents.createdAt))
      .limit(1);
    if (open) redirect(`/checkout/${open.id}`);
  }

  const intent = await createPaymentIntent({
    merchantId,
    amount: 425_000n,
    currency: "GBP",
    settlementCurrency: "SGD",
    description: "Q3 2026 Southeast Asia Fintech Market Intelligence Report",
    reference: "INV-4471",
    productId: seedId("prod", "sea-report"),
    customerId: seedId("cus", "kestrel"),
    agentPolicyId: seedId("pol", "kestrel-default"),
    origin: "agent",
    method: "bank",
    webhookUrl: `${env.APP_URL}/api/webhooks/test`,
  });

  redirect(`/checkout/${intent.id}`);
}
