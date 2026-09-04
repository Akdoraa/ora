import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/shell";
import { Card, Hairline, Badge } from "@/components/ui/primitives";
import { StatusPill } from "@/components/dashboard/status-pill";
import { merchantPayments } from "@/lib/analytics/merchant";
import { currentMerchantId } from "@/lib/dashboard";
import { fmtMinor, humanSeconds } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const payments = await merchantPayments(currentMerchantId(), 200);
  return (
    <DashboardShell active="/dashboard/payments" title="Payments">
      <Card className="overflow-hidden">
        {/* Wide fixed-column table: scrolls in its own box on narrow screens,
            the page itself never scrolls horizontally. */}
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(0,1fr)_90px_110px_120px_110px_130px] gap-2 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-faint">
              <span>Payment</span>
              <span>Origin</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Merchant net</span>
              <span className="text-right">Settled</span>
              <span className="text-right">Status</span>
            </div>
            <Hairline />
            {payments.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/payments/${p.id}`}
                className="grid grid-cols-[minmax(0,1fr)_90px_110px_120px_110px_130px] items-center gap-2 border-t border-line px-5 py-3 text-sm first:border-0 hover:bg-sky-50/50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">
                    {p.reference ?? p.description}
                  </span>
                  <span className="font-mono text-[11px] text-faint">{p.id}</span>
                </span>
                <Badge tone={p.origin === "agent" ? "sky" : "neutral"}>{p.origin}</Badge>
                <span className="text-right font-mono text-[13px]">
                  {fmtMinor(p.amount, p.currency)}
                </span>
                <span className="text-right font-mono text-[13px] text-muted">
                  {fmtMinor(p.settlementAmount, p.settlementCurrency)}
                </span>
                <span className="text-right font-mono text-[12px] text-faint">
                  {humanSeconds(p.settlementSeconds)}
                </span>
                <span className="text-right">
                  <StatusPill status={p.status} />
                </span>
              </Link>
            ))}
          </div>
        </div>
        {payments.length === 0 && (
          <div className="px-5 py-8 text-sm text-muted">
            No payments.{" "}
            <Link href="/demo" className="text-brand hover:underline">
              Run the demo →
            </Link>
          </div>
        )}
      </Card>
      <p className="mt-3 text-[11px] text-faint">
        {payments.length} payment{payments.length === 1 ? "" : "s"} · demo data on XRPL Testnet
      </p>
    </DashboardShell>
  );
}
