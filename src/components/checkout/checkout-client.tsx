"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/primitives";
import { AgentDecisionPanel } from "@/components/agent/decision-panel";
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
  accountMask: string;
}
type IdentityStep = "phone" | "otp" | "link-bank" | "ready";

/**
 * Literal implementation of the Figma "Payment Checkout Design" community
 * file's Bank Payment Flow (figma.com/design/Q2lTr8Ebc5ZsUvPjTeFNoH, node
 * 129:485), pulled via the Figma MCP connector — exact colors (#0a0d13 text,
 * #acacac muted/stroke, #32c770 pay-button green, #f9fafa order-summary
 * panel, #d9d9d9 border), exact Inter type spec, exact two-column layout
 * (Payment | Order Summary), and the exact "Choose your bank" dropdown
 * pattern instead of a tile grid. Only genuine additions: the phone/OTP
 * identity step (the reference has none — Ora needs one) and the live
 * agent/settlement flow, styled to match the same input/button language.
 */
export function CheckoutClient({ initial }: { initial: IntentAggregate }) {
  const router = useRouter();
  const { data, status, refresh, startPolling } = useIntent(initial.id ?? initial.intent.id, initial);
  const [busy, setBusy] = useState<null | "run" | "approve" | "decline">(null);
  const [error, setError] = useState<string | null>(null);
  const redirected = useRef(false);

  const [identityStep, setIdentityStep] = useState<IdentityStep>("phone");
  const [phone, setPhone] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");
  // demo only — no SMS provider is wired up, so there's nothing to receive on
  // a real phone. Rather than silently pre-filling the code (which never
  // looked like a real OTP entry), the field starts empty and this offers it
  // as a tap-to-fill suggestion, the same pattern iOS/Android use for a code
  // that arrived by text — the payer still has to act on it themselves.
  const [suggestedOtp, setSuggestedOtp] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [bankListOpen, setBankListOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<SelectedBank | null>(null);
  const [returning, setReturning] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

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

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      const res = await fetch("/api/checkout/identify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const body = await res.json();
      if (!res.ok) {
        setIdentityError(body.message ?? "couldn't send a code to that number");
        return;
      }
      setChallengeId(body.challengeId);
      // present only when no SMS provider actually sent a real text (see
      // src/lib/identity/sms.ts) — once one does, this stays null and the
      // payer has to type the code that actually arrived on their phone.
      setSuggestedOtp(body.devCode ?? null);
      setIdentityStep("otp");
    } catch (e) {
      setIdentityError(e instanceof Error ? e.message : "network error");
    } finally {
      setIdentityBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      const res = await fetch("/api/checkout/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId, code: otpInput }),
      });
      const body = await res.json();
      if (!res.ok) {
        setIdentityError(body.message ?? "that code didn't work");
        return;
      }
      setCustomerId(body.customerId);
      if (body.savedBank) {
        setSelectedBank(body.savedBank);
        setReturning(true);
        setIdentityStep("ready");
      } else {
        const banksRes = await fetch("/api/checkout/banks?country=GB");
        const banksBody = await banksRes.json();
        setBanks(banksBody.banks ?? []);
        setIdentityStep("link-bank");
      }
    } catch (e) {
      setIdentityError(e instanceof Error ? e.message : "network error");
    } finally {
      setIdentityBusy(false);
    }
  }

  async function pickBank(bank: BankOption) {
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      const res = await fetch("/api/checkout/link-bank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId, bankId: bank.id, country: "GB" }),
      });
      const body = await res.json();
      if (!res.ok) {
        setIdentityError(body.message ?? "couldn't connect that bank");
        return;
      }
      setSelectedBank(body);
      setBankListOpen(false);
      setIdentityStep("ready");
    } catch (e) {
      setIdentityError(e instanceof Error ? e.message : "network error");
    } finally {
      setIdentityBusy(false);
    }
  }

  function useDifferentNumber() {
    setIdentityStep("phone");
    setPhone("");
    setChallengeId(null);
    setOtpInput("");
    setSuggestedOtp(null);
    setCustomerId(null);
    setSelectedBank(null);
    setReturning(false);
    setIdentityError(null);
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

  const running = RUNNING.has(status) || busy === "run" || busy === "approve";
  const identified = identityStep === "ready" && !!selectedBank;
  const fc = { color: "var(--fc-text)" };
  const fcMuted = { color: "var(--fc-muted)" };

  return (
    <div className="ora-checkout-bg min-h-dvh">
      {/* The reference "Bank Payment Flow" frame is 1440px wide with the two
          panels split edge-to-edge 50/50 (Order summary's own background
          spans the full right half, no margin) — not a narrow centered
          card. mx-auto max-w-[1440px] reproduces that literally: full-bleed
          on any screen up to 1440px, centered beyond it. */}
      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-2">
        {/* ── Payment ─────────────────────────────────────────────────── */}
        <div className="p-6 sm:p-10">
          <div className="mb-2 flex items-center justify-between text-[13px]" style={fcMuted}>
            <span>{merchant?.displayName}</span>
            <span>ora</span>
          </div>

          <h1 className="text-[22px] font-semibold tracking-tight" style={fc}>
            Payment
          </h1>
          <div className="my-3 h-px" style={{ background: "var(--fc-border)" }} />

          <div className="mt-7">
            <div className="text-[16px] font-semibold" style={fc}>
              Pay With:
            </div>
            <div className="mt-3 flex gap-5">
              <RadioOption label="Card" disabled />
              <RadioOption label="Bank" active />
              <RadioOption label="Transfer" disabled />
            </div>
          </div>

          {status === "created" && (
            <div className="mt-6" aria-live="polite">
              {identityStep === "phone" && (
                <form onSubmit={submitPhone} className="ora-step space-y-4">
                  <FcField label="Phone number">
                    <input
                      id="checkout-phone"
                      type="tel"
                      required
                      autoComplete="tel"
                      placeholder="+44 7700 900123"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="fc-input"
                    />
                  </FcField>
                  <button type="submit" disabled={identityBusy} className="fc-pay-button">
                    {identityBusy ? "…" : "Continue"}
                  </button>
                </form>
              )}

              {identityStep === "otp" && (
                <form onSubmit={submitOtp} className="ora-step space-y-4">
                  <FcField label={`Code sent to ${phone}`}>
                    <input
                      id="checkout-otp"
                      type="text"
                      inputMode="numeric"
                      required
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value)}
                      className="fc-input font-mono"
                    />
                  </FcField>
                  {suggestedOtp && suggestedOtp !== otpInput && (
                    <button
                      type="button"
                      onClick={() => setOtpInput(suggestedOtp)}
                      className="rounded-[4px] border px-3 py-1.5 font-mono text-[13px]"
                      style={{ borderColor: "var(--fc-border)", color: "var(--fc-text)" }}
                    >
                      Use {suggestedOtp}
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button type="submit" disabled={identityBusy} className="fc-pay-button flex-1">
                      {identityBusy ? "…" : "Verify"}
                    </button>
                    <button type="button" onClick={useDifferentNumber} className="fc-secondary-button">
                      Back
                    </button>
                  </div>
                </form>
              )}

              {identityStep === "link-bank" && (
                <div className="ora-step flex flex-col items-start gap-4">
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
                          disabled={identityBusy}
                          className="w-full py-3 pr-[110px] pl-4 text-left text-[16px] hover:underline"
                          style={fcMuted}
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {identityStep === "ready" && selectedBank && (
                <div className="ora-step flex items-center justify-between" style={fc}>
                  <span className="text-[16px]">
                    {returning ? "Welcome back — " : "Connected — "}
                    {selectedBank.bankName} {selectedBank.accountMask}
                  </span>
                  <button type="button" onClick={useDifferentNumber} className="text-[14px] hover:underline" style={fcMuted}>
                    not you?
                  </button>
                </div>
              )}

              {identityError && (
                <p className="mt-2 text-[14px] text-negative">{identityError}</p>
              )}
            </div>
          )}

          {/* primary action / state */}
          <div className="mt-9" aria-live="polite" aria-atomic="true">
            {status === "created" && identified && (
              <div className="ora-step">
                <button onClick={run} disabled={busy === "run"} className="fc-pay-button">
                  {busy === "run" ? "…" : `Pay ${fmtMinor(intent.amount, intent.currency)}`}
                </button>
              </div>
            )}

            {running && status !== "awaiting_agent_approval" && (
              <div className="flex items-center gap-2.5 rounded-[4px] bg-[#f3f1ec] px-3.5 py-3 text-[14px]" style={fc}>
                <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                <StatusLine status={status} />
              </div>
            )}

            {/* A small, passive animation of what's happening underneath —
                never a fee/cost figure (that's the merchant dashboard's
                job), and never anything to click: the payer isn't choosing
                a route, just watching Ora check real ones and settle on
                one. Every name/status here is the same real, live data the
                merchant sees in full on their own dashboard. */}
            {status !== "created" && routeCount > 0 && (
              <div
                className="ora-route-collapse mt-3 overflow-hidden rounded-[4px] border"
                style={{ borderColor: "var(--fc-border)" }}
              >
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
            )}

            {status === "awaiting_agent_approval" && approval && (
              <div className="rounded-[4px] border border-warning/40 bg-warning-bg px-4 py-3.5">
                <div className="text-[16px] font-semibold" style={fc}>
                  Approval needed
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => decide("approve")}
                    disabled={busy === "approve"}
                    className="fc-pay-button flex-1"
                  >
                    {busy === "approve" ? "…" : `Approve ${fmtMinor(intent.amount, intent.currency)}`}
                  </button>
                  <button
                    onClick={() => decide("reject")}
                    disabled={busy === "decline"}
                    className="fc-secondary-button"
                  >
                    Decline
                  </button>
                </div>
              </div>
            )}

            {(status === "delivered" || status === "paid") && (
              <button onClick={() => router.push(`/checkout/${intent.id}/receipt`)} className="fc-pay-button">
                View receipt
              </button>
            )}

            {FAILED.has(status) && (
              <div className="rounded-[4px] border border-negative/30 bg-negative-bg px-4 py-3 text-[14px]">
                <div className="font-semibold text-negative">{status.replace(/_/g, " ")}</div>
              </div>
            )}

            {error && <p className="mt-2 text-[14px] text-negative">{error}</p>}
          </div>
        </div>

        {/* ── Order Summary ───────────────────────────────────────────── */}
        <div style={{ background: "var(--fc-panel)", borderLeft: "1px solid var(--fc-border)" }} className="p-6 sm:p-10">
          <h2 className="text-[22px] font-semibold tracking-tight" style={fc}>
            Order Summary
          </h2>
          <div className="my-3 h-px" style={{ background: "var(--fc-border)" }} />

          <div className="mt-7 flex gap-4">
            <div
              className="grid h-[70px] w-[70px] shrink-0 place-items-center rounded-[4px] border"
              style={{ borderColor: "var(--fc-muted)" }}
            >
              <DocIcon />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-4 text-[18px] font-medium" style={fc}>
                <span className="truncate">{intent.description}</span>
                <span className="shrink-0">{fmtMinor(intent.amount, intent.currency)}</span>
              </div>
              {intent.reference && (
                <div className="mt-1 text-[16px]" style={fcMuted}>
                  Invoice {intent.reference}
                </div>
              )}
            </div>
          </div>

          <div className="my-6 h-px" style={{ background: "var(--fc-border)" }} />

          <div className="space-y-4 text-[16px]" style={fc}>
            <div className="flex justify-between">
              <span>Merchant receives</span>
              <span>{intent.settlementCurrency}</span>
            </div>
          </div>

          <div className="my-6 h-px" style={{ background: "var(--fc-border)" }} />

          <div className="flex items-start justify-between gap-4">
            <div className="text-[16px] font-medium" style={fc}>
              Total
            </div>
            <div className="text-[32px] font-medium" style={fc}>
              {fmtMinor(intent.amount, intent.currency)}
            </div>
          </div>
        </div>
      </div>

      {/* ── agent activity — customer-safe: what's routing/settling the
          payment, never processing-fee/cost figures (that's for the
          merchant's own dashboard, not the payer). ────────────────────── */}
      <div className="mx-auto max-w-[1440px] px-6 pb-10 sm:px-10">
        {data.agentRun ? (
          <AgentDecisionPanel data={data} audience="customer" />
        ) : (
          <Card className="flex items-center justify-between p-5">
            <span className="text-[15px] font-semibold text-ink">
              Ora agent — routes &amp; settles your payment
            </span>
            <span className="text-[12px] text-faint">idle</span>
          </Card>
        )}
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

function FcField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[16px] font-medium" style={{ color: "var(--fc-text)" }}>
        {label}
      </span>
      {children}
    </label>
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

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="var(--fc-muted)" strokeWidth="1.5" aria-hidden>
      <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M14 3v4h4M9 13h6M9 17h6" strokeLinecap="round" />
    </svg>
  );
}
