"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIntent, type IntentAggregate } from "@/hooks/use-intent";
import { fmtMinor, humanSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";

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

// No fee/threshold figures here on purpose — those already live on the
// payer's standing AgentPolicy (maxProcessingFeeBps, autoApproveUnderAmount,
// etc., see scripts/seed.ts) and can only ever be *tightened* by this text,
// never loosened (src/lib/policies/policy.ts effectiveConstraints/
// requiresApproval) — so restating them here was always redundant, and
// looked like the payer's own fee ceiling instead of the payer's policy.
const DEMO_OBJECTIVE = "Pay invoice INV-4471 from Marina Analytics today, using the standing payment policy.";

interface BankOption {
  id: string;
  name: string;
  logoInitials: string;
}
interface SelectedBank {
  bankId: string;
  bankName: string;
}
type BankStep = "pick" | "connecting" | "ready";

/**
 * Pixel-exact port of the Figma "Payment Checkout Design" community file's
 * Bank Payment Flow (figma.com/design/Q2lTr8Ebc5ZsUvPjTeFNoH, node 129:485),
 * values pulled live via get_design_context (not eyeballed): the 130px/18px
 * asymmetric column insets, the 75px+48px combined top offset, the 36px
 * inter-section gaps, and — the one everyone notices — the 221px reserved
 * gap between the bank picker and the pay button. Two deliberate, disclosed
 * departures from the literal reference: (1) the "Including $X in taxes"
 * caption under Total is omitted — Ora's standing rule is that fee/cost
 * figures never appear on the payer's side (see DEMO_OBJECTIVE comment
 * above), and a tax caption is the same category of thing; (2) the
 * Subtotal/Shipping pair is replaced with two real Ora facts (settlement
 * currency + network) since Ora has neither a subtotal/shipping split nor
 * a discount-code system — the discount row itself is kept for visual
 * fidelity but rendered disabled rather than faked as functional. Genuine
 * addition beyond the reference: the live routing panel underneath the
 * whole card, and a slim merchant-identity strip above it — neither of
 * which touches the reference's own internal spacing.
 */
export function CheckoutClient({ initial }: { initial: IntentAggregate }) {
  const router = useRouter();
  const { data, status, refresh, startPolling } = useIntent(initial.id ?? initial.intent.id, initial);
  const [busy, setBusy] = useState<null | "run" | "approve" | "decline">(null);
  const [error, setError] = useState<string | null>(null);
  const redirected = useRef(false);

  const [bankStep, setBankStep] = useState<BankStep>("pick");
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [bankListOpen, setBankListOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<SelectedBank | null>(null);

  useEffect(() => {
    if (status !== "created") return;
    fetch("/api/checkout/banks?country=GB")
      .then((r) => r.json())
      .then((b) => setBanks(b.banks ?? []))
      .catch(() => {});
  }, [status]);

  const intent = data.intent;
  const merchant = data.merchant;
  const approval = (data.approvals ?? []).find((a: { status: string }) => a.status === "pending");

  // The payer never picks a route — they just pay. This is purely a small,
  // passive "here's what happened underneath" animation: the routes and
  // their outcomes are 100% real (the same ones the merchant's dashboard
  // shows in full), just revealed one at a time instead of all at once, so
  // watching it actually reads as "Ora is checking routes right now"
  // instead of a table appearing mid-blink. Once every route has settled,
  // it collapses down to a single small line.
  const routeCount = data.routes?.length ?? 0;
  const [routesRevealed, setRoutesRevealed] = useState(0);
  const [routesCollapsed, setRoutesCollapsed] = useState(false);
  const routeRevealStarted = useRef(false);

  useEffect(() => {
    if (routeCount === 0 || routeRevealStarted.current) return;
    routeRevealStarted.current = true;
    let cancelled = false;
    let i = 0;
    const revealNext = () => {
      if (cancelled) return;
      i += 1;
      setRoutesRevealed(i);
      if (i < routeCount) {
        setTimeout(revealNext, 380);
      } else {
        setTimeout(() => {
          if (!cancelled) setRoutesCollapsed(true);
        }, 900);
      }
    };
    const t = setTimeout(revealNext, 320);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [routeCount]);

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

  // No account behind this — picking a bank just means logging into it, every
  // time, right here. The brief "connecting" beat is a genuine UI state (not
  // a fake progress bar hiding a real network call): there's nothing to
  // authenticate against yet, the real bank authorization happens later,
  // server-side, once the agent actually runs (see confirmBankAuthorization
  // in src/lib/agent/runner.ts) — this is just picking which bank that step
  // will use.
  function pickBank(bank: BankOption) {
    setBankListOpen(false);
    setSelectedBank({ bankId: bank.id, bankName: bank.name });
    setBankStep("connecting");
    setTimeout(() => setBankStep("ready"), 700);
  }

  function useDifferentBank() {
    setBankStep("pick");
    setSelectedBank(null);
  }

  async function run() {
    setBusy("run");
    setError(null);
    startPolling();
    try {
      const res = await fetch(`/api/payment-intents/${intent.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective: DEMO_OBJECTIVE, bankId: selectedBank?.bankId }),
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

  const identified = bankStep === "ready" && !!selectedBank;
  const fc = { color: "var(--fc-text)" };
  const fcMuted = { color: "var(--fc-muted)" };

  // Exactly one of these is ever true, so the action slot always renders one
  // element of the same shape — the pay button never appears/disappears
  // based on whether a bank is picked yet, which is what keeps the 221px
  // gap above it visually constant across every state, not just at rest.
  const phase: "pay" | "approve" | "running" | "receipt" | "failed" =
    status === "awaiting_agent_approval" && approval
      ? "approve"
      : status === "delivered" || status === "paid"
        ? "receipt"
        : FAILED.has(status)
          ? "failed"
          : RUNNING.has(status) || busy === "run"
            ? "running"
            : "pay";

  return (
    <div className="ora-checkout-bg min-h-dvh">
      {/* Slim identity strip — a genuine necessary addition (someone has to
          say which merchant you're paying), kept outside the grid below so
          it never disturbs the reference's own top-123px offset. */}
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-4 text-[13px] sm:px-10" style={fcMuted}>
        <span>{merchant?.displayName}</span>
        <OraLogo />
      </div>

      {/* The reference "Bank Payment Flow" frame is 1440px wide with the two
          panels split edge-to-edge 50/50 (Order summary's own background
          spans the full right half, no margin) — not a narrow centered
          card. mx-auto max-w-[1440px] reproduces that literally: full-bleed
          on any screen up to 1440px, centered beyond it. */}
      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-2">
        {/* ── Payment — literal node 129:525 ──────────────────────────── */}
        <div className="flex flex-col gap-9 p-6 sm:p-10 lg:pb-[48px] lg:pl-[178px] lg:pr-[48px] lg:pt-[123px]">
          <div className="flex flex-col gap-2">
            <h1 className="text-[24px] font-semibold leading-[28px] tracking-[-0.48px]" style={fc}>
              Payment
            </h1>
            <div className="h-px w-full lg:w-[476px]" style={{ background: "var(--fc-border)" }} />
          </div>

          <div className="flex flex-col gap-4">
            <div className="text-[18px] font-semibold" style={fc}>
              Pay With:
            </div>
            <div className="flex gap-[19px]">
              <RadioOption label="Card" disabled />
              <RadioOption label="Bank" active />
              <RadioOption label="Transfer" disabled />
            </div>
          </div>

          <div className="flex flex-col gap-9 lg:gap-[221px]">
            <div aria-live="polite">
              {status === "created" ? (
                <>
                  {bankStep === "pick" && (
                    <div className="ora-step flex w-full flex-col items-start gap-2 lg:w-[476px]">
                      <button
                        type="button"
                        onClick={() => setBankListOpen((v) => !v)}
                        className="fc-dropdown-trigger"
                        aria-expanded={bankListOpen}
                      >
                        <span>Choose your bank</span>
                        <ChevronIcon up={bankListOpen} />
                      </button>
                      {bankListOpen && (
                        <div className="flex w-full flex-col items-start rounded-[8px]" style={{ background: "var(--fc-panel)" }}>
                          {banks.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => pickBank(b)}
                              className="w-full px-4 py-3 text-left text-[16px] hover:underline"
                              style={fcMuted}
                            >
                              {b.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {bankStep === "connecting" && selectedBank && (
                    <div className="ora-step flex items-center gap-2.5 text-[16px] lg:w-[476px]" style={fcMuted}>
                      <span
                        aria-hidden
                        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/15"
                        style={{ borderTopColor: "var(--fc-muted)" }}
                      />
                      Logging in to {selectedBank.bankName}…
                    </div>
                  )}

                  {bankStep === "ready" && selectedBank && (
                    <div className="ora-step flex items-center justify-between text-[16px] lg:w-[476px]" style={fc}>
                      <span>Connected — {selectedBank.bankName}</span>
                      <button type="button" onClick={useDifferentBank} className="text-[14px] hover:underline" style={fcMuted}>
                        not you?
                      </button>
                    </div>
                  )}
                </>
              ) : (
                selectedBank && (
                  <div className="flex items-center text-[16px] lg:w-[476px]" style={fc}>
                    Connected — {selectedBank.bankName}
                  </div>
                )
              )}
            </div>

            <div className="flex w-full flex-col items-start gap-[23px] lg:w-[476px]" aria-live="polite" aria-atomic="true">
              {phase === "pay" && (
                <button onClick={run} disabled={!identified} className="fc-pay-button">
                  {`Pay ${fmtMinor(intent.amount, intent.currency)}`}
                </button>
              )}

              {phase === "approve" && (
                <div className="flex w-full gap-2">
                  <button onClick={() => decide("approve")} disabled={busy === "approve"} className="fc-pay-button flex-1">
                    {busy === "approve" ? "…" : `Approve ${fmtMinor(intent.amount, intent.currency)}`}
                  </button>
                  <button onClick={() => decide("reject")} disabled={busy === "decline"} className="fc-secondary-button">
                    Decline
                  </button>
                </div>
              )}

              {phase === "running" && (
                <div className="flex w-full items-center gap-2.5 rounded-[4px] bg-[#f3f1ec] px-3.5 py-3 text-[14px]" style={fc}>
                  <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                  <StatusLine status={status} />
                </div>
              )}

              {phase === "receipt" && (
                <button onClick={() => router.push(`/checkout/${intent.id}/receipt`)} className="fc-pay-button">
                  View receipt
                </button>
              )}

              {phase === "failed" && (
                <div className="w-full rounded-[4px] border border-negative/30 bg-negative-bg px-4 py-3 text-[14px]">
                  <div className="font-semibold text-negative">{status.replace(/_/g, " ")}</div>
                </div>
              )}

              {status === "created" && (
                <p className="text-[14px] leading-[22px]" style={fcMuted}>
                  Your bank login is used only to authorize this payment — Ora never stores your bank credentials.
                </p>
              )}

              {error && <p className="text-[14px] text-negative">{error}</p>}
            </div>
          </div>
        </div>

        {/* ── Order Summary — literal node 172:912 ────────────────────── */}
        <div
          style={{ background: "var(--fc-panel)", borderLeft: "1px solid var(--fc-border)" }}
          className="flex flex-col gap-9 p-6 sm:p-10 lg:pb-[48px] lg:pl-[66px] lg:pr-[48px] lg:pt-[123px]"
        >
          <div className="flex flex-col gap-2">
            <h2 className="text-[24px] font-semibold leading-[28px] tracking-[-0.48px]" style={fc}>
              Order Summary
            </h2>
            <div className="h-px w-full lg:w-[476px]" style={{ background: "var(--fc-border)" }} />
          </div>

          <div className="flex gap-4 lg:w-[476px]">
            <div
              className="grid h-[70px] w-[70px] shrink-0 place-items-center rounded-[4px] border"
              style={{ borderColor: "var(--fc-muted)" }}
            >
              <DocIcon />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-4 text-[18px] font-medium" style={fc}>
                <span className="truncate">{intent.description}</span>
                <span className="shrink-0">{fmtMinor(intent.amount, intent.currency)}</span>
              </div>
              {intent.reference && (
                <div className="flex items-baseline justify-between gap-4 text-[16px] font-medium" style={fcMuted}>
                  <span className="truncate">Invoice {intent.reference}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-9 lg:w-[476px]">
            <div className="h-px w-full" style={{ background: "var(--fc-border)" }} />
            <div className="flex w-full gap-4">
              <input
                disabled
                placeholder="Gift or discount code"
                className="min-w-0 flex-1 rounded-[4px] border-[1.5px] bg-white px-4 py-[14px] text-[16px] disabled:cursor-not-allowed"
                style={{ borderColor: "var(--fc-muted)", color: "var(--fc-muted)" }}
              />
              <button
                type="button"
                disabled
                className="shrink-0 rounded-[4px] border-[1.5px] px-[23px] py-[13px] text-[16px] font-medium disabled:cursor-not-allowed"
                style={{ borderColor: "var(--fc-muted)", background: "var(--fc-muted)", color: "var(--fc-green-text)" }}
              >
                Apply
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-6 lg:w-[476px]">
            <div className="h-px w-full" style={{ background: "var(--fc-border)" }} />
            <div className="flex w-full flex-col gap-4 text-[16px] font-medium" style={fc}>
              <div className="flex justify-between">
                <span>Merchant receives</span>
                <span>{intent.settlementCurrency}</span>
              </div>
              <div className="flex justify-between">
                <span>Settles on</span>
                <span>XRPL Testnet</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6 lg:w-[476px]">
            <div className="h-px w-full" style={{ background: "var(--fc-border)" }} />
            <div className="flex w-full items-start justify-between gap-4">
              <div className="text-[16px] font-medium" style={fc}>
                Total
              </div>
              <div className="text-[36px] font-medium" style={fc}>
                {fmtMinor(intent.amount, intent.currency)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── the one small "live" panel, underneath the whole card ───────── */}
      {status !== "created" && routeCount > 0 && (
        <div className="mx-auto max-w-[1440px] px-6 pb-10 sm:px-10">
          <div className="ora-route-collapse overflow-hidden rounded-[4px] border" style={{ borderColor: "var(--fc-border)" }}>
            {routesCollapsed ? (
              <RoutingSummaryLine routes={data.routes} />
            ) : (
              <>
                <div className="flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium" style={fc}>
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
                    style={{ background: "#32c770" }}
                  />
                  Routing your payment
                </div>
                <div className="border-t px-2 pt-2" style={{ borderColor: "var(--fc-border)" }}>
                  <RoutingWeb routes={data.routes} revealedCount={routesRevealed} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
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

function RouteStatusIcon({ status }: { status: string }) {
  if (status === "selected") {
    return (
      <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded-full" style={{ background: "#32c770" }}>
        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="white" strokeWidth="2">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span
        aria-hidden
        className="h-4 w-4 shrink-0 rounded-full border"
        style={{ borderColor: "var(--fc-muted)" }}
      />
    );
  }
  if (status === "qualified") {
    return (
      <span
        aria-hidden
        className="h-4 w-4 shrink-0 rounded-full border-2"
        style={{ borderColor: "var(--fc-muted)" }}
      />
    );
  }
  // candidate — still being checked
  return (
    <span
      aria-hidden
      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-black/15"
      style={{ borderTopColor: "var(--fc-muted)" }}
    />
  );
}

const ROUTE_KIND_LABEL: Record<string, string> = {
  xrpl_rlusd: "Direct",
  xrpl_amm: "AMM pool",
  xrpl_orderbook: "Order book",
  xrpl_combined: "Combined",
};

/**
 * The routes fan out from "Bank" to "Merchant" like strands of a web, each
 * one a real candidate Ora actually checked. A strand draws itself in (real
 * SVG path-drawing, not a fade) as its route gets revealed, coloured by its
 * real final outcome; the winning strand gets a small dot that keeps
 * travelling along it. Purely decorative math for spacing/curves — every
 * name, kind, and outcome drawn is the real route data.
 */
function RoutingWeb({
  routes,
  revealedCount,
}: {
  routes: { id: string; kind: string; displayName: string; status: string }[];
  revealedCount: number;
}) {
  const n = routes.length;
  const srcX = 20;
  const dstX = 300;
  const midX = 160;
  const baseY = 58;
  const spacing = n <= 1 ? 0 : Math.min(26, 88 / (n - 1));
  const ys = routes.map((_, i) => baseY + (i - (n - 1) / 2) * spacing);

  return (
    <svg viewBox="0 0 320 112" className="w-full" style={{ height: 112 }} aria-hidden>
      <circle cx={srcX} cy={baseY} r={3.5} fill="var(--fc-text)" />
      <circle cx={dstX} cy={baseY} r={3.5} fill="var(--fc-text)" />
      <text x={srcX} y={baseY + 18} textAnchor="middle" fontSize="9" fill="var(--fc-muted)">
        Bank
      </text>
      <text x={dstX} y={baseY + 18} textAnchor="middle" fontSize="9" fill="var(--fc-muted)">
        Merchant
      </text>

      {routes.map((r, i) => {
        const revealed = i < revealedCount;
        const y = ys[i]!;
        const d = `M${srcX},${baseY} Q${midX},${y} ${dstX},${baseY}`;
        const isWinner = revealed && r.status === "selected";
        const color = !revealed
          ? "var(--fc-border)"
          : r.status === "selected"
            ? "#32c770"
            : r.status === "qualified"
              ? "var(--fc-text)"
              : "var(--fc-muted)";
        return (
          <g key={r.id}>
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={isWinner ? 2.25 : 1.25}
              strokeLinecap="round"
              pathLength={100}
              className="ora-web-strand"
              style={{ strokeDasharray: 100, strokeDashoffset: revealed ? 0 : 100 }}
            />
            <circle
              cx={midX}
              cy={y}
              r={isWinner ? 4.5 : 3.5}
              fill={revealed ? color : "var(--fc-panel)"}
              stroke={color}
              strokeWidth={1.25}
              className={cn("ora-web-node", isWinner && "ora-route-pop")}
            />
            {revealed && (
              <text
                x={midX}
                y={y - 9}
                textAnchor="middle"
                fontSize="9"
                fill={isWinner ? "var(--fc-text)" : "var(--fc-muted)"}
              >
                {ROUTE_KIND_LABEL[r.kind] ?? r.displayName}
              </text>
            )}
            {isWinner && (
              <circle r={2.75} fill="#32c770">
                <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Once every route has settled, the panel collapses down to this one small
 * line — still real data (the actual winning route + its real settlement
 * time), just no longer taking up space once there's nothing left to watch. */
function RoutingSummaryLine({ routes }: { routes: { displayName: string; estimatedSeconds: number }[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const winner = (routes as any[]).find((r) => r.status === "selected");
  if (!winner) return null;
  return (
    <div className="ora-route-collapse flex items-center justify-between px-3.5 py-2.5 text-[13px]">
      <span className="flex items-center gap-2">
        <RouteStatusIcon status="selected" />
        <span style={{ color: "var(--fc-text)" }}>Routed via {winner.displayName}</span>
      </span>
      <span className="text-[11px]" style={{ color: "var(--fc-muted)" }}>
        settles in {humanSeconds(winner.estimatedSeconds)}
      </span>
    </div>
  );
}

function RadioOption({ label, active, disabled }: { label: string; active?: boolean; disabled?: boolean }) {
  return (
    <span
      className="flex items-center gap-2 text-[16px]"
      style={{ color: disabled ? "var(--fc-muted)" : "var(--fc-text)" }}
      aria-current={active ? "true" : undefined}
    >
      <span
        aria-hidden
        className="grid h-[15px] w-[15px] place-items-center rounded-full border"
        style={{ borderColor: active ? "#32c770" : "var(--fc-muted)" }}
      >
        {active && <span className="h-[7px] w-[7px] rounded-full" style={{ background: "#32c770" }} />}
      </span>
      {label}
    </span>
  );
}

function ChevronIcon({ up }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-[18px] w-[18px] transition-transform ${up ? "rotate-180" : ""}`}
      fill="none"
      stroke="var(--fc-muted)"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OraLogo() {
  return (
    <span className="flex items-center gap-1 font-bold" style={{ color: "var(--fc-text)" }}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
        <path d="M13.2 1 3.6 13.4h6L9.4 23 20.4 9.6h-6.2L13.2 1Z" />
      </svg>
      ora
    </span>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="var(--fc-muted)" strokeWidth="1.5" aria-hidden>
      <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M14 3v4h4M9 13h6M9 17h6" strokeLinecap="round" />
    </svg>
  );
}
