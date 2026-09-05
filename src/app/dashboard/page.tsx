import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/shell";
import { Card, Hairline } from "@/components/ui/primitives";
import { Stat, BarChart } from "@/components/dashboard/stat";
import {
  merchantOverview,
  merchantPayments,
  merchantVolumeSeries,
} from "@/lib/analytics/merchant";
import { currentMerchantId } from "@/lib/dashboard";
import { fmtMinor, fmtDateTime } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Merchant dashboard" };

const STATUS_DOT: Record<string, string> = {
  delivered: "bg-positive",
  paid: "bg-positive",
  awaiting_agent_approval: "bg-warning",
  settling: "bg-brand",
  cancelled: "bg-negative",
  payment_failed: "bg-negative",
};

export default async function DashboardOverview() {
  const merchantId = currentMerchantId();
  const [ov, payments, series] = await Promise.all([
    merchantOverview(merchantId),
    merchantPayments(merchantId, 6),
    merchantVolumeSeries(merchantId),
  ]);
  if (!ov) {
    return (
      <DashboardShell active="/dashboard" title="Overview">
        <Card className="p-6 text-sm text-muted">
          No seeded merchant. Run <code className="font-mono">pnpm db:seed</code>.
        </Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      active="/dashboard"
      title="Overview"
      action={
        <Link
          href="/demo?fresh=1"
          className="rounded-[4px] bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-soft"
        >
          New checkout
        </Link>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Volume" value={fmtMinor(ov.totalVolumeMinor, ov.volumeCurrency)} />
        <Stat label="Success rate" value={`${ov.successRatePct}%`} />
        <Stat label="Saved vs card" value={fmtMinor(ov.savingsMinor, "GBP")} tone="positive" />
      </div>

      <Card className="mt-3 p-5">
        <div className="mb-3 text-[13px] font-medium text-ink">Volume</div>
        <BarChart
          data={series.map((s) => ({
            label: s.day.slice(5),
            value: Number(s.volumeMinor) / 100,
          }))}
          format={(n) => fmtMinor(BigInt(Math.round(n * 100)), ov.volumeCurrency)}
        />
      </Card>

      <Card className="mt-3 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-[13px] font-medium text-ink">Recent transactions</span>
          <Link href="/dashboard/payments" className="text-[13px] text-brand hover:underline">
            All →
          </Link>
        </div>
        <Hairline />
        <div className="divide-y divide-line">
          {payments.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/payments/${p.id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-sky-50/50"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[p.status] ?? "bg-faint"}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">
                  {p.reference ?? p.description.slice(0, 40)}
                </div>
                <div className="text-[12px] text-faint">{fmtDateTime(p.createdAt)}</div>
              </div>
              <div className="shrink-0 font-mono text-[13px] text-ink">
                {fmtMinor(p.amount, p.currency)}
              </div>
            </Link>
          ))}
          {payments.length === 0 && (
            <div className="px-5 py-6 text-sm text-muted">
              No payments yet.{" "}
              <Link href="/demo" className="text-brand hover:underline">
                Run the demo →
              </Link>
            </div>
          )}
        </div>
      </Card>
    </DashboardShell>
  );
}
