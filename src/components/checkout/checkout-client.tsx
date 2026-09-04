"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge, Card, Hairline, Row } from "@/components/ui/primitives";
import { OraWordmark } from "@/components/brand/wordmark";
import { AgentDecisionPanel } from "@/components/agent/decision-panel";
import { useIntent, type IntentAggregate } from "@/hooks/use-intent";
import { fmtMinor } from "@/lib/format";

const RUNNING = new Set([
  "awaiting_route",
  "route_selected",
  "awaiting_bank_authorization",
  "bank_confirmed",
  "x402_quote_paid",
  "settling",
  "paid",
]);
const FAILED = new Set([
  "authorization_failed",
  "payment_failed",
  "settlement_failed",
  "fulfilment_failed",
  "expired",
  "cancelled",
]);

const DEMO_OBJECTIVE =
  "Pay invoice INV-4471 from Marina Analytics today. They must receive SGD. " +
  "Keep processing cost at or below 1%, use a qualified route, settle in under 60 seconds, " +
  "and ask for my approval if the final amount exceeds £4,000.";

export function CheckoutClient({ initial }: { initial: IntentAggregate }) {
  const router = useRouter();
  const { data, status, refresh, startPolling } = useIntent(initial.id ?? initial.intent.id, initial);
  const [busy, setBusy] = useState<null | "run" | "approve" | "decline">(null);
  const [error, setError] = useState<string | null>(null);
  const redirected = useRef(false);

  const intent = data.intent;
  const merchant = data.merchant;
  const product = data.product;
  const approval = (data.approvals ?? []).find((a: { status: string }) => a.status === "pending");

  useEffect(() => {
    if ((status === "delivered" || status === "paid") && !redirected.current) {
      redirected.current = true;
      const t = setTimeout(() => router.push(`/checkout/${intent.id}/receipt`), 900);
      return () => clearTimeout(t);
    }
  }, [status, intent.id, router]);

  useEffect(() => {
    if (RUNNING.has(status)) startPolling();
  }, [status, startPolling]);

  async function run() {
    setBusy("run");
    setError(null);
    startPolling();
    try {
      const res = await fetch(`/api/payment-intents/${intent.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective: DEMO_OBJECTIVE }),
      });
      const body = await res.json();
      if (body.status === "failed") setError(body.error ?? "the agent run failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(null);
    }
  }

  async function decide(decision: "approve" | "reject") {
    setBusy(decision === "approve" ? "approve" : "decline");
    setError(null);
    startPolling();
    try {
      const res = await fetch(`/api/payment-intents/${intent.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, decidedBy: "Akdora Celepoglu" }),
      });
      const body = await res.json();
      if (body.status === "failed") setError(body.error ?? "settlement failed after approval");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(null);
    }
  }

  const fee = fmtMinor(intent.estimatedCardFeeAmount, intent.currency);
  const running = RUNNING.has(status) || busy === "run" || busy === "approve";

  return (
    <div className="ora-checkout-bg min-h-dvh px-4 py-8 sm:px-6 sm:py-14">
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
        {/* ── the checkout card ─────────────────────────────────────────── */}
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">{merchant?.displayName}</span>
            <OraWordmark className="text-[15px] text-ink" />
          </div>

          <Hairline className="my-4" />

          <div className="space-y-1">
            <h1 className="font-serif text-lg leading-snug text-ink">
              {product?.name ?? intent.description}
            </h1>
            {intent.reference && (
              <p className="font-mono text-[12px] text-faint">Invoice {intent.reference}</p>
            )}
          </div>

          <div className="mt-5">
            <Row label="Amount" value={fmtMinor(intent.amount, intent.currency)} strong />
            <Row label="Merchant receives" value={intent.settlementCurrency} />
            <Row label="Card processing (≈4%)" value={<s className="text-faint">{fee}</s>} />
            <Row
              label={<span className="text-ink">Ora fee (1%)</span>}
              value={<span className="text-positive">charged to the merchant</span>}
            />
          </div>

          <Hairline className="my-4" />

          {/* method — Figma "Pay With" reduced to Ora's single clean option */}
          <div className="rounded-xl border border-sky-300 bg-sky-50 px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-paper">
                <BankGlyph />
              </span>
              <div>
                <div className="text-sm font-medium text-ink">Pay by bank</div>
                <div className="text-[12px] text-muted">
                  No card number. No card expiry. No CVC.
                </div>
              </div>
            </div>
          </div>

          <p className="mt-3 text-[12px] leading-snug text-muted">
            Ora selects the fastest qualified route within your payment policy and settles
            globally. You approve the amount before any money moves.
          </p>

          {/* primary action / state */}
          <div className="mt-5">
            {status === "created" && (
              <Button full size="lg" onClick={run} loading={busy === "run"}>
                Authorize with Ora agent
              </Button>
            )}

            {running && status !== "awaiting_agent_approval" && (
              <div className="flex items-center gap-2.5 rounded-xl bg-[#f3f1ec] px-3.5 py-3 text-sm text-ink-soft">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
                <StatusLine status={status} />
              </div>
            )}

            {status === "awaiting_agent_approval" && approval && (
              <div className="rounded-xl border border-warning/40 bg-warning-bg px-4 py-3.5">
                <div className="text-sm font-semibold text-ink">Approval needed</div>
                <p className="mt-1 text-[13px] leading-snug text-ink-soft">{approval.reason}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => decide("approve")} loading={busy === "approve"}>
                    Approve {fmtMinor(intent.amount, intent.currency)}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => decide("reject")}
                    loading={busy === "decline"}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            )}

            {(status === "delivered" || status === "paid") && (
              <Button full size="lg" variant="secondary" onClick={() => router.push(`/checkout/${intent.id}/receipt`)}>
                Payment complete — view receipt →
              </Button>
            )}

            {FAILED.has(status) && (
              <div className="rounded-xl border border-negative/30 bg-negative-bg px-4 py-3 text-sm">
                <div className="font-semibold text-negative">Payment {status.replace(/_/g, " ")}</div>
                <p className="mt-1 text-[13px] text-ink-soft">
                  {intent.failureReason ?? "The payment could not be completed."}
                </p>
              </div>
            )}

            {error && <p className="mt-2 text-[12px] text-negative">{error}</p>}
          </div>

          <p className="mt-4 text-center font-mono text-[10px] text-faint">
            Ripple track · XRPL Testnet · sandbox bank rail
          </p>
        </Card>

        {/* ── agent activity ────────────────────────────────────────────── */}
        <div className="space-y-4">
          {data.agentRun ? (
            <AgentDecisionPanel data={data} />
          ) : (
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <span className="font-sans text-[15px] font-semibold text-ink">Ora agent</span>
                <Badge tone="neutral">idle</Badge>
              </div>
              <p className="mt-2 font-serif text-[15px] leading-relaxed text-muted">
                Start the payment and Ora’s agent will parse the objective, compare qualified
                routes, buy a signed FX quote over x402, and settle — pausing for your approval
                where the policy requires it.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: string }) {
  const map: Record<string, string> = {
    awaiting_route: "Discovering and comparing qualified routes…",
    route_selected: "Route selected — authorizing your bank…",
    awaiting_bank_authorization: "Waiting for bank confirmation…",
    bank_confirmed: "Bank confirmed — checking your approval policy…",
    x402_quote_paid: "Signed FX quote locked — settling on XRPL…",
    settling: "Settling on XRPL…",
    paid: "Settled. Delivering your purchase…",
  };
  return <span>{map[status] ?? "Working…"}</span>;
}

function BankGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M10 2 2 6v1.5h16V6zM3.5 9v6H2v1.5h16V15h-1.5V9H15v6h-2.25V9h-1.5v6h-2.5V9h-1.5v6H4V9z" />
    </svg>
  );
}
