import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getIntentAggregate } from "@/lib/payment-intents/service";
import { jsonSafe } from "@/lib/api/serialize";
import { CheckoutClient } from "@/components/checkout/checkout-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const agg = await getIntentAggregate(id);
  return {
    title: agg?.merchant ? `Pay ${agg.merchant.displayName}` : "Checkout",
  };
}

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agg = await getIntentAggregate(id);
  if (!agg) notFound();
  return <CheckoutClient initial={jsonSafe(agg)} />;
}
