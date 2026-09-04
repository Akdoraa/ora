import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/shell";
import { Card, Hairline, Row, Badge } from "@/components/ui/primitives";
import { getDb, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { seedId } from "@/lib/ids";
import { fmtMinor, fmtPct, humanSeconds, fmtDateTime } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Agent console" };

export default async function AgentConsole() {
  const db = await getDb();
  const [policy] = await db
    .select()
    .from(schema.agentPolicies)
    .where(eq(schema.agentPolicies.id, seedId("pol", "kestrel-default")))
    .limit(1);
  const runs = await db
    .select()
    .from(schema.agentRuns)
    .orderBy(desc(schema.agentRuns.startedAt))
    .limit(20);

  return (
    <DashboardShell active="/dashboard/agent-console" title="Agent console">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:items-start">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wide text-faint">
              Payment policy
            </span>
            <Badge tone="neutral">Kestrel Digital</Badge>
          </div>
          {policy ? (
            <div className="mt-3">
              <Row label="Currency" value={policy.policyCurrency} mono />
              <Row label="Max per payment" value={fmtMinor(policy.maxPaymentAmount, policy.policyCurrency)} />
              <Row label="Max daily spend" value={fmtMinor(policy.maxDailySpendAmount, policy.policyCurrency)} />
              <Row label="Auto-approve under" value={fmtMinor(policy.autoApproveUnderAmount, policy.policyCurrency)} />
              <Row label="Max processing fee" value={fmtPct(policy.maxProcessingFeeBps)} />
              <Row label="Max FX spread" value={fmtPct(policy.maxFxSpreadBps)} />
              <Row label="Required settlement" value={humanSeconds(policy.requiredSettlementSeconds)} />
              <Row label="Approved currencies" value={(policy.approvedCurrencies ?? []).join(", ")} mono />
              <Row
                label="New-payee approval"
                value={policy.requireApprovalForNewPayee ? "required" : "off"}
              />
              <Hairline className="my-3" />
              <p className="text-[11px] text-faint">
                The objective can only <em>tighten</em> these. Hard caps (max payment, daily spend)
                are re-checked by the transaction executor and cannot be overridden by the model.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">No seeded policy.</p>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-3 text-[12px] font-medium uppercase tracking-wide text-faint">
            Agent runs
          </div>
          <Hairline />
          {runs.map((r) => (
            <Link
              key={r.id}
              href={`/dashboard/payments/${r.paymentIntentId}`}
              className="block border-t border-line px-5 py-3 first:border-0 hover:bg-sky-50/50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px] text-ink">{r.paymentIntentId}</span>
                <Badge
                  tone={
                    r.status === "completed" ? "positive" : r.status === "failed" ? "negative" : "warning"
                  }
                >
                  {r.status.replace(/_/g, " ")}
                </Badge>
              </div>
              <p className="mt-1 line-clamp-2 font-serif text-[14px] text-ink-soft">
                {r.decisionSummary ?? r.objectiveText}
              </p>
              <div className="mt-1 font-mono text-[10px] text-faint">
                {r.mode === "live" ? r.model : "deterministic demo"} · {fmtDateTime(r.startedAt)}
                {r.failureReason ? ` · ${r.failureReason}` : ""}
              </div>
            </Link>
          ))}
          {runs.length === 0 && (
            <div className="px-5 py-8 text-sm text-muted">
              No agent runs.{" "}
              <Link href="/demo" className="text-brand hover:underline">
                Run the demo →
              </Link>
            </div>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
