import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/shell";
import { Card, Hairline } from "@/components/ui/primitives";
import { KpiCard, BarChart } from "@/components/dashboard/stat";
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
        <Link href="/demo?fresh=1" className="dc-button">
          New checkout
        </Link>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          tone="purple-dark"
          icon={<VolumeIcon />}
          title="Volume"
          value={fmtMinor(ov.totalVolumeMinor, ov.volumeCurrency)}
          pill={ov.volumeCurrency}
        />
        <KpiCard
          tone="blue"
          icon={<PulseIcon />}
          title="Success rate"
          value={`${ov.successRatePct}%`}
          pill="of intents"
        />
        <KpiCard
          tone="lime"
          icon={<PiggyIcon />}
          title="Saved vs card"
          value={fmtMinor(ov.savingsMinor, "GBP")}
          pill="vs 4%"
        />
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

// Minimal 16px line icons for the KPI card badges — no icon set dependency.
function VolumeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 12V8M6 12V4M10 12V6M14 12V2" strokeLinecap="round" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 8h3l1.5-4L9 12l1.5-4H15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PiggyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 9a5 5 0 0 1 9.8-1.5L14 7v3l-1.6.3A5 5 0 0 1 2 9Z" strokeLinejoin="round" />
      <circle cx="5" cy="9" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
