"use client";

import { useState } from "react";
import { Badge, Card, Hairline, Row } from "@/components/ui/primitives";
import { fmtMinor, fmtPct, humanSeconds, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { IntentAggregate } from "@/hooks/use-intent";

const STEP_LABEL: Record<string, string> = {
  parsePaymentObjective: "Understood the objective",
  discoverMerchantOffer: "Found the merchant offer",
  listQualifiedRoutes: "Discovered routes",
  inspectRouteTerms: "Read route terms",
  evaluateRoutes: "Compared routes against policy",
  confirmBankAuthorization: "Bank authorization",
  requestHumanApproval: "Checked the approval policy",
  handleX402Payment: "Bought a signed FX quote (x402)",
  executeXRPLSettlement: "Settled on XRPL",
  verifyXRPLTransaction: "Verified settlement on-ledger",
  triggerMerchantFulfilment: "Triggered fulfilment",
  generateReceipt: "Wrote the receipt",
};

type Audience = "merchant" | "customer";

/**
 * The same agent-activity panel is used on the merchant's own payment-detail
 * page ("merchant", full detail — policy, every route's cost, the full
 * decision trace) and on the payer-facing checkout ("customer" — what's
 * routing/settling the payment, never Ora's/the merchant's processing-fee
 * figures, the merchant's policy text, or the internal reasoning trace; a
 * payer doesn't see a card network's interchange economics either).
 */
export function AgentDecisionPanel({
  data,
  audience = "merchant",
}: {
  data: IntentAggregate;
  audience?: Audience;
}) {
  const run = data.agentRun;
  const decisions: any[] = data.agentDecisions ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const routes: any[] = data.routes ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [open, setOpen] = useState(audience !== "customer");
  const isCustomer = audience === "customer";

  if (!run) return null;

  const visibleRoutes = isCustomer ? routes.filter((r) => r.status === "selected") : routes;

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
        aria-expanded={open}
        aria-label={open ? "Collapse agent activity" : "Expand agent activity"}
      >
        <span className="flex items-center gap-2">
          <span className="font-sans text-[15px] font-semibold text-ink">
            {isCustomer ? "Ora agent — routes & settles your payment" : "Ora agent"}
          </span>
          <Badge tone={run.status === "completed" ? "positive" : run.status === "failed" ? "negative" : "sky"}>
            {run.status.replace(/_/g, " ")}
          </Badge>
          {!isCustomer && (
            <span className="font-mono text-[11px] text-faint">
              {run.mode === "live" ? run.model : "deterministic demo"}
            </span>
          )}
        </span>
        <span className="text-faint">{open ? "–" : "+"}</span>
      </button>

      {open && (
        <div className="border-t border-line">
          {/* objective + parsed constraints — the merchant's own policy
              text/thresholds, not something the payer needs to see */}
          {!isCustomer && (
            <>
              <div className="px-5 py-4">
                <p className="font-sans text-[15px] leading-relaxed text-ink-soft">
                  “{run.objectiveText}”
                </p>
                {run.parsedConstraints && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(run.parsedConstraints).map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded bg-[#f3f1ec] px-1.5 py-0.5 font-mono text-[11px] text-ink-soft"
                      >
                        {k}={String(v)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Hairline />
            </>
          )}

          {/* routes */}
          {visibleRoutes.length > 0 && (
            <div className="px-5 py-4">
              <div className="mb-2 text-xs font-medium text-faint">
                {isCustomer ? "Routed via" : "Routes considered"}
              </div>
              <div className="space-y-2">
                {visibleRoutes.map((r) => (
                  <RouteRow
                    key={r.id}
                    route={r}
                    currency={data.intent.currency}
                    audience={audience}
                  />
                ))}
              </div>
            </div>
          )}

          {/* decision timeline — internal reasoning, merchant-only */}
          {!isCustomer && (
            <>
              <Hairline />
              <div className="px-5 py-4">
                <div className="mb-2 text-xs font-medium text-faint">Decision trace</div>
                <ol className="space-y-2.5">
                  {decisions.map((d) => (
                    <li key={d.id} className="flex gap-3 text-sm">
                      <span
                        className={cn(
                          "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                          d.ok ? "bg-positive" : "bg-negative",
                        )}
                      />
                      <div className="min-w-0">
                        <span className="font-medium text-ink">{STEP_LABEL[d.tool] ?? d.tool}</span>
                        {d.reason && (
                          <p className="mt-0.5 text-[13px] leading-snug text-muted">{d.reason}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}

          {/* settlement details — real on-chain proof, not a fee figure;
              shown to both audiences */}
          {data.xrplTransactions?.length > 0 && (
            <>
              <Hairline />
              <SettlementDetails data={data} />
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function RouteRow({
  route: r,
  currency,
  audience,
}: {
  route: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  currency: string;
  audience: Audience;
}) {
  const isCustomer = audience === "customer";
  const tone =
    r.status === "selected" ? "positive" : r.status === "qualified" ? "sky" : "negative";
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        r.status === "selected" ? "border-positive/40 bg-positive-bg/40" : "border-line",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">
          {r.displayName}
          {!isCustomer && r.isSynthetic && (
            <span className="ml-2 font-mono text-[10px] uppercase text-faint">demo quote</span>
          )}
        </span>
        {!isCustomer && <Badge tone={tone}>{r.status}</Badge>}
      </div>
      {isCustomer ? (
        <div className="mt-1.5 font-mono text-[11px] text-muted">
          settles in {humanSeconds(r.estimatedSeconds)}
        </div>
      ) : (
        <>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-muted">
            <span>fee {fmtPct(r.processingFeeBps)}</span>
            <span>fx {fmtPct(r.fxSpreadBps)}</span>
            <span>{humanSeconds(r.estimatedSeconds)}</span>
            <span>{fmtPct(r.reliabilityBps, 1)} uptime</span>
            <span>cost {fmtMinor(r.totalCostAmount, currency)}</span>
          </div>
          {r.rejectionReasons?.length > 0 && (
            <p className="mt-1 text-[12px] text-negative">{r.rejectionReasons.join(" · ")}</p>
          )}
          {r.scoreExplanation && r.status === "selected" && (
            <p className="mt-1 text-[12px] leading-snug text-ink-soft">{r.scoreExplanation}</p>
          )}
        </>
      )}
    </div>
  );
}

export function SettlementDetails({ data }: { data: IntentAggregate }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txs: any[] = data.xrplTransactions ?? [];
  const x402 = data.x402;
  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium text-faint">Settlement details</span>
        <Badge tone="warning" className="font-mono lowercase tracking-normal">
          xrpl testnet
        </Badge>
      </div>
      {x402?.quotePayload && (
        <Row
          label="Signed FX quote"
          value={`${x402.quotePayload.pair} @ ${x402.quotePayload.effectiveRate} · x402`}
          mono
        />
      )}
      {txs.map((t) => (
        <Row
          key={t.id}
          label={t.kind === "x402_payment" ? "x402 quote payment" : t.kind}
          value={
            t.txHash ? (
              <a
                href={t.explorerUrl ?? `https://testnet.xrpl.org/transactions/${t.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-brand underline decoration-brand/30 underline-offset-2"
              >
                {shortHash(t.txHash)} {t.validated ? "✓" : ""}
              </a>
            ) : (
              "—"
            )
          }
          mono
        />
      ))}
    </div>
  );
}
