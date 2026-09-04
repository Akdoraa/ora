import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/shell";
import { Card, Hairline, Badge } from "@/components/ui/primitives";
import { Stat, BarChart } from "@/components/dashboard/stat";
import {
  merchantOverview,
  merchantPayments,
  merchantVolumeSeries,
} from "@/lib/analytics/merchant";
import { currentMerchantId } from "@/lib/dashboard";
import { fmtMinor, humanSeconds, fmtDateTime } from "@/lib/format";
import { StatusPill } from "@/components/dashboard/status-pill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Merchant dashboard" };

export default async function DashboardOverview() {
  const merchantId = currentMerchantId();
  const [ov, payments, series] = await Promise.all([
    merchantOverview(merchantId),
    merchantPayments(merchantId, 6),
    merchantVolumeSeries(merchantId),
  ]);
  if (!ov) {
    return (
      <DashboardShell active="/dashboard" title="Merchant dashboard">
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
          className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-soft"
        >
          New demo checkout →
        </Link>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Payment volume"
          value={fmtMinor(ov.totalVolumeMinor, ov.volumeCurrency)}
          sub={`${ov.paidCount} paid · ${ov.paymentsCount} total`}
        />
        <Stat
          label="Success rate"
          value={`${ov.successRatePct}%`}
          sub={`${ov.failedCount} failed`}
        />
        <Stat
          label="Avg settlement"
          value={ov.avgSettlementSeconds ? humanSeconds(ov.avgSettlementSeconds) : "—"}
          sub="bank-confirmed → merchant paid"
        />
        <Stat
          label="Saved vs card (4%)"
          value={fmtMinor(ov.savingsMinor, "GBP")}
          sub={
            <>
              Ora fees {fmtMinor(ov.oraFeesMinor, "GBP")} vs card{" "}
              {fmtMinor(ov.cardEquivalentFeesMinor, "GBP")}
            </>
          }
          tone="positive"
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wide text-faint">
              Volume · last 14 days
            </span>
            <Badge tone="warning" className="font-mono lowercase tracking-normal">
              xrpl testnet
            </Badge>
          </div>
          <BarChart
            data={series.map((s) => ({
              label: s.day.slice(5),
              value: Number(s.volumeMinor) / 100,
            }))}
            format={(n) => fmtMinor(BigInt(Math.round(n * 100)), ov.volumeCurrency)}
          />
        </Card>

        <Card className="p-5">
          <div className="text-[12px] font-medium uppercase tracking-wide text-faint">
            Where payments came from
          </div>
          <div className="mt-3 space-y-2">
            <OriginRow label="AI agent" value={ov.agentOriginatedCount} total={ov.paymentsCount} />
            <OriginRow label="Human checkout" value={ov.humanOriginatedCount} total={ov.paymentsCount} />
          </div>
          <Hairline className="my-4" />
          <div className="text-[12px] font-medium uppercase tracking-wide text-faint">Pending</div>
          <div className="mt-1 font-sans text-xl font-semibold text-ink">
            {ov.pendingSettlementsCount}
          </div>
          <div className="text-[12px] text-muted">payments mid-flow</div>
        </Card>
      </div>

      <Card className="mt-3 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-[12px] font-medium uppercase tracking-wide text-faint">
            Recent payments
          </span>
          <Link href="/dashboard/payments" className="text-[13px] text-brand hover:underline">
            All payments →
          </Link>
        </div>
        <Hairline />
        <table className="w-full text-sm">
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-line first:border-0 hover:bg-sky-50/50">
                <td className="py-2.5 pl-5">
                  <Link href={`/dashboard/payments/${p.id}`} className="font-medium text-ink hover:underline">
                    {p.reference ?? p.description.slice(0, 40)}
                  </Link>
                  <div className="font-mono text-[11px] text-faint">{p.id}</div>
                </td>
                <td className="py-2.5">
                  <Badge tone={p.origin === "agent" ? "sky" : "neutral"}>{p.origin}</Badge>
                </td>
                <td className="py-2.5 text-right font-mono text-[13px]">
                  {fmtMinor(p.amount, p.currency)}
                </td>
                <td className="py-2.5 pr-5 text-right">
                  <StatusPill status={p.status} />
                </td>
                <td className="hidden py-2.5 pr-5 text-right font-mono text-[11px] text-faint sm:table-cell">
                  {fmtDateTime(p.createdAt)}
                </td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-sm text-muted" colSpan={5}>
                  No payments yet.{" "}
                  <Link href="/demo" className="text-brand hover:underline">
                    Run the demo →
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </DashboardShell>
  );
}

function OriginRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-soft">{label}</span>
        <span className="font-mono text-[13px] text-ink">
          {value} <span className="text-faint">· {pct}%</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f0ede6]">
        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
