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

export function CheckoutClient({ initial }: { initial: IntentAggregate }) {
  const router = useRouter();
  const { data, status, refresh, startPolling } = useIntent(initial.id ?? initial.intent.id, initial);
  const [busy, setBusy] = useState<null | "run" | "approve" | "decline">(null);
  const [error, setError] = useState<string | null>(null);
  const redirected = useRef(false);

  // ── phone + OTP identity, Magic-style: link a bank once, remembered next time ──
  const [identityStep, setIdentityStep] = useState<IdentityStep>("phone");
  const [phone, setPhone] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [selectedBank, setSelectedBank] = useState<SelectedBank | null>(null);
  const [returning, setReturning] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const intent = data.intent;
  const merchant = data.merchant;
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
      // demo only — a real integration texts this, it never appears here;
      // pre-filling it is what lets this run live without a real phone
      setDevCode(body.devCode);
      setOtpInput(body.devCode);
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
    setDevCode(null);
    setOtpInput("");
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

  const fee = fmtMinor(intent.estimatedCardFeeAmount, intent.currency);
  const running = RUNNING.has(status) || busy === "run" || busy === "approve";
  const identified = identityStep === "ready" && !!selectedBank;

  return (
    <div className="ora-checkout-bg min-h-dvh px-4 py-8 sm:px-6 sm:py-14">
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
        {/* ── the checkout card — Figma "Payment Checkout Design" layout ── */}
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">{merchant?.displayName}</span>
            <OraWordmark className="text-[15px] text-ink" />
          </div>

          <h1 className="mt-5 font-sans text-2xl font-bold tracking-tight text-ink">Payment</h1>

          <div className="mt-4">
            <Row label="Amount" value={fmtMinor(intent.amount, intent.currency)} strong />
            <Row label="Merchant receives" value={intent.settlementCurrency} />
            <Row label="Card (≈4%)" value={<s className="text-faint">{fee}</s>} />
            <Row
              label="Ora fee (1%)"
              value={<span className="text-positive">merchant pays</span>}
            />
          </div>

          <Hairline className="my-4" />

          {/* Pay with — Card / Bank / Transfer, matching the reference tab row.
              Ora only moves money by bank: Card and Transfer are shown, disabled. */}
          <div className="mb-4">
            <div className="mb-2 text-[13px] font-medium text-ink">Pay with</div>
            <div className="flex gap-4">
              <PayWithOption label="Card" disabled />
              <PayWithOption label="Bank" active />
              <PayWithOption label="Transfer" disabled />
            </div>
          </div>

          {/* ── phone + OTP identity, replacing card-number/expiry/CVV fields ── */}
          {status === "created" && (
            <div aria-live="polite">
              {identityStep === "phone" && (
                <form onSubmit={submitPhone} className="ora-step space-y-3">
                  <Field label="Phone number">
                    <input
                      id="checkout-phone"
                      type="tel"
                      required
                      autoComplete="tel"
                      placeholder="+44 7700 900123"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="ora-input"
                    />
                  </Field>
                  <Button type="submit" full loading={identityBusy}>
                    Continue
                  </Button>
                </form>
              )}

              {identityStep === "otp" && (
                <form onSubmit={submitOtp} className="ora-step space-y-3">
                  <Field label={`Code sent to ${phone}`}>
                    <input
                      id="checkout-otp"
                      type="text"
                      inputMode="numeric"
                      required
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value)}
                      className="ora-input font-mono"
                    />
                  </Field>
                  {devCode && <p className="text-[12px] text-faint">Demo — pre-filled, no SMS sent.</p>}
                  <div className="flex gap-2">
                    <Button type="submit" full loading={identityBusy}>
                      Verify
                    </Button>
                    <Button type="button" variant="secondary" onClick={useDifferentNumber}>
                      Back
                    </Button>
                  </div>
                </form>
              )}

              {identityStep === "link-bank" && (
                <div className="ora-step space-y-3">
                  <div className="text-[13px] font-medium text-ink">Choose your bank</div>
                  <div className="grid grid-cols-2 gap-2">
                    {banks.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => pickBank(b)}
                        disabled={identityBusy}
                        className="flex items-center gap-2 rounded-[4px] border border-line-strong px-3 py-2.5 text-left disabled:opacity-50"
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[4px] bg-ink text-[10px] font-semibold text-paper">
                          {b.logoInitials}
                        </span>
                        <span className="text-[13px] text-ink">{b.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {identityStep === "ready" && selectedBank && (
                <div className="ora-step flex items-center justify-between rounded-[4px] border border-line-strong px-3.5 py-2.5">
                  <div className="text-[13px] text-ink">
                    {returning ? "Welcome back — " : "Connected — "}
                    {selectedBank.bankName} {selectedBank.accountMask}
                  </div>
                  <button
                    type="button"
                    onClick={useDifferentNumber}
                    className="shrink-0 text-[12px] text-faint hover:text-ink hover:underline"
                  >
                    not you?
                  </button>
                </div>
              )}

              {identityError && <p className="mt-2 text-[12px] text-negative">{identityError}</p>}
            </div>
          )}

          {/* primary action / state */}
          <div className="mt-4" aria-live="polite" aria-atomic="true">
            {status === "created" && identified && (
              <Button
                full
                size="lg"
                onClick={run}
                loading={busy === "run"}
                className="bg-[#16a34a] text-white hover:bg-[#128a3e]"
              >
                Pay {fmtMinor(intent.amount, intent.currency)}
              </Button>
            )}

            {running && status !== "awaiting_agent_approval" && (
              <div className="flex items-center gap-2.5 rounded-[4px] bg-[#f3f1ec] px-3.5 py-3 text-sm text-ink-soft">
                <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
                <StatusLine status={status} />
              </div>
            )}

            {status === "awaiting_agent_approval" && approval && (
              <div className="rounded-[4px] border border-warning/40 bg-warning-bg px-4 py-3.5">
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
                View receipt
              </Button>
            )}

            {FAILED.has(status) && (
              <div className="rounded-[4px] border border-negative/30 bg-negative-bg px-4 py-3 text-sm">
                <div className="font-semibold text-negative">{status.replace(/_/g, " ")}</div>
                <p className="mt-1 text-[13px] text-ink-soft">
                  {intent.failureReason ?? "The payment could not be completed."}
                </p>
              </div>
            )}

            {error && <p className="mt-2 text-[12px] text-negative">{error}</p>}
          </div>

          <p className="mt-4 text-center text-[11px] text-faint">XRPL testnet · sandbox bank rail</p>
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
              <p className="mt-2 font-sans text-[15px] leading-relaxed text-muted">
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

function PayWithOption({ label, active, disabled }: { label: string; active?: boolean; disabled?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 text-[13px] ${disabled ? "text-faint" : "text-ink"}`}
      aria-current={active ? "true" : undefined}
    >
      <span
        aria-hidden
        className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${
          active ? "border-[#16a34a]" : "border-line-strong"
        }`}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />}
      </span>
      {label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
