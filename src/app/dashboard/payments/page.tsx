import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/shell";
import { PaymentsTable } from "@/components/dashboard/payments-table";
import { merchantPayments } from "@/lib/analytics/merchant";
import { currentMerchantId } from "@/lib/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const payments = await merchantPayments(currentMerchantId(), 200);
  return (
    <DashboardShell active="/dashboard/payments" title="Payments">
      <PaymentsTable payments={payments} />
      {payments.length === 0 ? (
        <p className="mt-3 text-[11px] text-faint">
          No payments yet.{" "}
          <Link href="/demo" className="text-brand hover:underline">
            Run the demo →
          </Link>
        </p>
      ) : (
        <p className="mt-3 text-[11px] text-faint">
          {payments.length} payment{payments.length === 1 ? "" : "s"} · demo data on XRPL Testnet
        </p>
      )}
    </DashboardShell>
  );
}
