import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/shell";
import { Card, Hairline, Row, Badge } from "@/components/ui/primitives";
import { StatusPill } from "@/components/dashboard/status-pill";
import { AgentDecisionPanel } from "@/components/agent/decision-panel";
import { PaymentActions } from "@/components/dashboard/payment-actions";
import { WebhookMini } from "@/components/dashboard/webhook-mini";
import { getIntentAggregate } from "@/lib/payment-intents/service";
import { getDb, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { jsonSafe } from "@/lib/api/serialize";
import { fmtMinor, humanSeconds, fmtDateTime, shortHash } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await getIntentAggregate(id);
  if (!raw) notFound();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = jsonSafe(raw) as any;
  const { intent } = data;

  const db = await getDb();
  const deliveries = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.paymentIntentId, id));

  return (
    <DashboardShell
      active="/dashboard/payments"
      title={intent.reference ?? "Payment"}
      action={
        <Link href="/dashboard/payments" className="text-[13px] text-brand hover:underline">
          ← All payments
        </Link>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[12px] text-faint">
        <span>{intent.id}</span>
        <StatusPill status={intent.status} />
        <Badge tone={intent.origin === "agent" ? "sky" : "neutral"}>{intent.origin}</Badge>
        {intent.failureReason && <span className="text-negative">{intent.failureReason}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="text-sm font-medium text-ink">{data.merchant?.displayName}</div>
            <p className="mt-1 font-sans text-[15px] text-ink-soft">{intent.description}</p>
            <Hairline className="my-4" />
            <Row label="Amount" value={fmtMinor(intent.amount, intent.currency)} strong />
            <Row
              label="Merchant net"
              value={fmtMinor(intent.settlementAmount ?? intent.merchantNetAmount, intent.settlementCurrency)}
              strong
            />
            <Row label="Ora fee (1%)" value={fmtMinor(intent.processingFeeAmount, intent.currency)} />
            <Row
              label="Card equivalent (4%)"
              value={<s className="text-faint">{fmtMinor(intent.estimatedCardFeeAmount, intent.currency)}</s>}
            />
            <Row
              label={<span className="text-positive">Saved vs card</span>}
              value={<span className="font-semibold text-positive">{fmtMinor(intent.savingsVsCardAmount, intent.currency)}</span>}
            />
            <Row label="Settlement time" value={humanSeconds(intent.settlementSeconds)} />
            <Row label="FX rate" value={intent.fxRate ?? "—"} mono />
            <Row label="Created" value={fmtDateTime(intent.createdAt)} />
          </Card>

          <PaymentActions
            intentId={intent.id}
            status={intent.status}
            checkoutUrl={`/checkout/${intent.id}`}
          />

          <Card className="p-5">
            <div className="text-[12px] font-medium uppercase tracking-wide text-faint">
              Webhook deliveries
            </div>
            <div className="mt-2 space-y-1.5">
              {deliveries.map((d) => (
                <WebhookMini
                  key={d.id}
                  d={{
                    id: d.id,
                    eventType: d.eventType,
                    status: d.status,
                    responseStatus: d.responseStatus,
                  }}
                />
              ))}
              {deliveries.length === 0 && (
                <p className="text-[13px] text-muted">No webhooks for this payment.</p>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {data.agentRun ? (
            <AgentDecisionPanel data={data} />
          ) : (
            <Card className="p-5 text-sm text-muted">Human-initiated payment — no agent run.</Card>
          )}

          <Card className="overflow-hidden">
            <div className="px-5 py-3 text-[12px] font-medium uppercase tracking-wide text-faint">
              Audit trail
            </div>
            <Hairline />
            <ol className="divide-y divide-line">
              {(data.audit ?? []).map((a: { id: string; type: string; summary: string; actor: string; createdAt: string }) => (
                <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-[13px]">
                  <div>
                    <span className="font-mono text-[11px] text-brand">{a.type}</span>
                    <p className="text-ink-soft">{a.summary}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    {a.actor} · {fmtDateTime(a.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          {data.xrplTransactions?.length > 0 && (
            <Card className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[12px] font-medium uppercase tracking-wide text-faint">
                  On-chain
                </span>
                <Badge tone="warning" className="font-mono lowercase tracking-normal">xrpl testnet</Badge>
              </div>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {data.xrplTransactions.map((t: any) => (
                <Row
                  key={t.id}
                  label={t.kind.replace(/_/g, " ")}
                  value={
                    <a href={t.explorerUrl} target="_blank" rel="noreferrer" className="text-brand underline decoration-brand/30 underline-offset-2">
                      {shortHash(t.txHash)} {t.validated ? "✓" : t.engineResult ?? ""}
                    </a>
                  }
                  mono
                />
              ))}
            </Card>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
