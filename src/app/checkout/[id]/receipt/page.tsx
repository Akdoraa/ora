import Link from "next/link";
import { notFound } from "next/navigation";
import { getIntentAggregate } from "@/lib/payment-intents/service";
import { jsonSafe } from "@/lib/api/serialize";
import { Card, Hairline, Row, Badge } from "@/components/ui/primitives";
import { OraWordmark } from "@/components/brand/wordmark";
import { ReceiptClient } from "@/components/checkout/receipt-client";
import { fmtMinor, humanSeconds, shortHash, fmtDateTime } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt" };

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const raw = await getIntentAggregate(id);
  if (!raw) notFound();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = jsonSafe(raw) as any;
  const { intent, merchant, fulfilment, x402 } = data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deliverable: any = fulfilment?.deliverable;
  const settled = intent.status === "delivered" || intent.status === "paid";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txs: any[] = data.xrplTransactions ?? [];
  const settlementTx = txs.find((t) => t.kind === "settlement");
  const x402Tx = txs.find((t) => t.kind === "x402_payment");

  return (
    <div className="ora-checkout-bg min-h-dvh px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-5 flex items-center justify-between">
          <OraWordmark className="text-lg text-ink" />
          <Link href="/" className="font-mono text-[12px] text-muted hover:text-ink">
            ora.cash
          </Link>
        </div>

        <Card className="overflow-hidden">
          <div className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-positive text-white">
                ✓
              </span>
              <h1 className="font-sans text-xl font-semibold text-ink">
                {settled ? "Payment complete" : `Payment ${intent.status.replace(/_/g, " ")}`}
              </h1>
            </div>
            <p className="mt-1.5 font-serif text-[15px] leading-relaxed text-ink-soft">
              {data.agentRun?.decisionSummary ??
                `Paid ${merchant?.displayName} by bank.`}
            </p>
          </div>

          <div className="px-6 py-5">
            <Row label="Paid to" value={merchant?.displayName} strong />
            <Row label="For" value={intent.description} />
            {intent.reference && <Row label="Invoice" value={intent.reference} mono />}
            <Row label="Receipt ref" value={intent.id} mono />
            <Row label="Completed" value={fmtDateTime(intent.settledAt ?? intent.updatedAt)} />
          </div>

          <Hairline />

          <div className="px-6 py-5">
            <Row label="Amount paid" value={fmtMinor(intent.amount, intent.currency)} strong />
            <Row
              label="Merchant received"
              value={fmtMinor(intent.settlementAmount ?? intent.merchantNetAmount, intent.settlementCurrency)}
              strong
            />
            <Row label="Ora processing fee" value={fmtMinor(intent.processingFeeAmount, intent.currency)} />
            <Row
              label="Estimated card fee (4%)"
              value={<s className="text-faint">{fmtMinor(intent.estimatedCardFeeAmount, intent.currency)}</s>}
            />
            <Row
              label={<span className="text-positive">Saved vs card</span>}
              value={
                <span className="font-semibold text-positive">
                  {fmtMinor(intent.savingsVsCardAmount, intent.currency)}
                </span>
              }
            />
            <Row label="Settlement time" value={humanSeconds(intent.settlementSeconds)} />
          </div>

          {deliverable && (
            <>
              <Hairline />
              <div className="px-6 py-5">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
                  Delivered
                </div>
                <div className="text-sm font-medium text-ink">{deliverable.title}</div>
                <p className="mt-1 text-[13px] text-muted">{deliverable.summary}</p>
                {fulfilment?.accessToken && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(deliverable.files ?? []).map((f: { name: string; sizeLabel: string }) => (
                      <a
                        key={f.name}
                        href={`/api/fulfilment/${intent.id}?token=${fulfilment.accessToken}`}
                        className="rounded-full border border-line-strong bg-card px-3 py-1.5 text-[13px] text-ink hover:bg-sky-50"
                      >
                        {f.name} <span className="text-faint">· {f.sizeLabel}</span>
                      </a>
                    ))}
                    {deliverable.apiCredentials && (
                      <span className="rounded-full bg-[#f3f1ec] px-3 py-1.5 font-mono text-[12px] text-ink-soft">
                        {deliverable.apiCredentials.credits.toLocaleString()} API credits
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <Hairline />

          {/* progressive disclosure — settlement details */}
          <details className="group px-6 py-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted">
              <span className="transition group-open:rotate-90">›</span> Settlement details
              <Badge tone="warning" className="font-mono lowercase tracking-normal">
                xrpl testnet
              </Badge>
            </summary>
            <div className="mt-2">
              {x402?.quotePayload && (
                <Row
                  label="Signed FX quote (x402)"
                  value={`${x402.quotePayload.pair} @ ${x402.quotePayload.effectiveRate}`}
                  mono
                />
              )}
              {x402Tx && (
                <Row
                  label="x402 quote payment"
                  value={
                    <a
                      href={x402Tx.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand underline decoration-brand/30 underline-offset-2"
                    >
                      {shortHash(x402Tx.txHash)} {x402Tx.validated ? "✓" : ""}
                    </a>
                  }
                  mono
                />
              )}
              {settlementTx && (
                <Row
                  label="XRPL settlement"
                  value={
                    <a
                      href={settlementTx.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand underline decoration-brand/30 underline-offset-2"
                    >
                      {shortHash(settlementTx.txHash)} {settlementTx.validated ? "✓" : ""}
                    </a>
                  }
                  mono
                />
              )}
              <Row label="FX rate" value={intent.fxRate ?? "—"} mono />
            </div>
          </details>

          <Hairline />
          <ReceiptClient intentId={intent.id} />
        </Card>

        <div className="mt-4 flex justify-center gap-4 text-[13px] text-muted">
          <Link href={`/checkout/${intent.id}`} className="hover:text-ink">
            ← Back to checkout
          </Link>
          <Link href="/dashboard" className="hover:text-ink">
            Merchant dashboard →
          </Link>
        </div>
      </div>
    </div>
  );
}
