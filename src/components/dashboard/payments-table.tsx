"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Hairline, Badge } from "@/components/ui/primitives";
import { StatusPill } from "@/components/dashboard/status-pill";
import { TabGroup } from "@/components/dashboard/kit";
import { fmtMinor, humanSeconds } from "@/lib/format";
import type { merchantPayments } from "@/lib/analytics/merchant";

type Payment = Awaited<ReturnType<typeof merchantPayments>>[number];

const FAILED = new Set([
  "authorization_failed",
  "payment_failed",
  "settlement_failed",
  "fulfilment_failed",
  "expired",
  "cancelled",
]);
const DELIVERED = new Set(["paid", "delivered", "partially_refunded", "refunded"]);

const FILTERS = [
  { value: "all", label: "All" },
  { value: "delivered", label: "Delivered" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
] as const;

function matches(status: string, filter: (typeof FILTERS)[number]["value"]) {
  if (filter === "all") return true;
  if (filter === "delivered") return DELIVERED.has(status);
  if (filter === "failed") return FAILED.has(status);
  return !DELIVERED.has(status) && !FAILED.has(status);
}

/** Payments list with a real, client-side status filter — the dash-template's
 * "_Tab" segmented control (node 2525:19986) over the actual payment rows,
 * not a decorative mock. */
export function PaymentsTable({ payments }: { payments: Payment[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const rows = useMemo(() => payments.filter((p) => matches(p.status, filter)), [payments, filter]);

  return (
    <>
      <div className="mb-3">
        <TabGroup options={[...FILTERS]} value={filter} onChange={(v) => setFilter(v as typeof filter)} />
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(0,1fr)_90px_110px_120px_110px_130px] gap-2 px-5 py-2.5 text-[12px] font-medium text-muted">
              <span>Payment</span>
              <span>Origin</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Merchant net</span>
              <span className="text-right">Settled</span>
              <span className="text-right">Status</span>
            </div>
            <Hairline />
            {rows.map((p) => (
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
        {rows.length === 0 && (
          <div className="px-5 py-8 text-sm text-muted">
            No {filter === "all" ? "" : filter} payments.
          </div>
        )}
      </Card>
    </>
  );
}
