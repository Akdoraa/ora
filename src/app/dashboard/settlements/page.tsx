import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/shell";
import { Card, Hairline, Badge, Row } from "@/components/ui/primitives";
import { merchantSettlements } from "@/lib/analytics/merchant";
import { trialBalance } from "@/lib/ledger/ledger";
import { currentMerchantId } from "@/lib/dashboard";
import { fmtMinor, shortHash, fmtDateTime } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Settlements" };

export default async function SettlementsPage() {
  const [settlements, tb] = await Promise.all([
    merchantSettlements(currentMerchantId()),
    trialBalance(),
  ]);

  const balanced = Object.values(tb).every((v) => v === 0n);

  return (
    <DashboardShell active="/dashboard/settlements" title="Settlements & reconciliation">
      <Card className="mb-4 p-5">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium uppercase tracking-wide text-faint">
            Ledger trial balance
          </span>
          <Badge tone={balanced ? "positive" : "negative"}>
            {balanced ? "balanced" : "drift detected"}
          </Badge>
        </div>
        <div className="mt-2">
          {Object.entries(tb).map(([ccy, v]) => (
            <Row key={ccy} label={ccy} value={v.toString()} mono strong={v !== 0n} />
          ))}
          {Object.keys(tb).length === 0 && (
            <p className="text-[13px] text-muted">No ledger activity yet.</p>
          )}
        </div>
        <p className="mt-2 text-[11px] text-faint">
          Every payment posts a balanced double-entry transaction; the sum in each currency must be
          zero. This is the economic-truth invariant.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_110px_130px] gap-2 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-faint">
              <span>Payment</span>
              <span className="text-right">Gross</span>
              <span className="text-right">Net paid</span>
              <span className="text-right">XRPL</span>
              <span className="text-right">Status</span>
            </div>
            <Hairline />
            {settlements.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[minmax(0,1fr)_120px_120px_110px_130px] items-center gap-2 border-t border-line px-5 py-3 text-sm first:border-0"
              >
                <Link
                  href={`/dashboard/payments/${s.paymentIntentId}`}
                  className="truncate font-mono text-[12px] text-ink hover:underline"
                >
                  {s.paymentIntentId}
                </Link>
                <span className="text-right font-mono text-[13px]">
                  {fmtMinor(s.grossAmount, s.grossCurrency)}
                </span>
                <span className="text-right font-mono text-[13px]">
                  {fmtMinor(s.netAmount, s.netCurrency)}
                </span>
                <span className="text-right font-mono text-[12px]">
                  {s.xrplTransaction?.txHash && s.xrplTransaction.explorerUrl ? (
                    <a
                      href={s.xrplTransaction.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand underline decoration-brand/30 underline-offset-2"
                    >
                      {shortHash(s.xrplTransaction.txHash, 6, 4)}
                    </a>
                  ) : s.xrplTransaction?.txHash ? (
                    shortHash(s.xrplTransaction.txHash, 6, 4)
                  ) : (
                    "—"
                  )}
                </span>
                <span className="text-right">
                  <Badge tone={s.status === "settled" ? "positive" : "warning"}>{s.status}</Badge>
                </span>
              </div>
            ))}
          </div>
        </div>
        {settlements.length === 0 && (
          <div className="px-5 py-8 text-sm text-muted">No settlements yet.</div>
        )}
      </Card>
      <p className="mt-3 text-[11px] text-faint">
        {settlements.length} settlement{settlements.length === 1 ? "" : "s"} ·{" "}
        {settlements[0] ? fmtDateTime(settlements[0].createdAt) : "—"}
      </p>
    </DashboardShell>
  );
}
