import { DashboardShell } from "@/components/dashboard/shell";
import { PaymentLinkForm } from "@/components/dashboard/payment-link-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Payment links" };

export default function PaymentLinksPage() {
  return (
    <DashboardShell active="/dashboard/payment-links" title="Create a payment link">
      <PaymentLinkForm />
    </DashboardShell>
  );
}
