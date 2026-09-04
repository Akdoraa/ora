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
  // Known Next.js 16 streaming trade-off, not a bug here: once a route's
  // shell starts streaming the response has committed to 200, so a
  // notFound() that fires afterward can't rewrite the status — Next injects
  // <meta name="robots" content="noindex"> instead (confirmed present). The
  // not-found UI itself renders correctly either way. See
  // node_modules/next/dist/docs/01-app/02-guides/streaming.md#status-codes.
  if (!agg) notFound();
  return {
    title: `Pay ${agg.merchant?.displayName ?? "Ora"}`,
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
