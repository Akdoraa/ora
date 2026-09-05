"use client";

import { useState } from "react";
import { Card, Hairline } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export function PaymentLinkForm() {
  const [amount, setAmount] = useState("4250.00");
  const [currency, setCurrency] = useState("GBP");
  const [settlement, setSettlement] = useState("SGD");
  const [description, setDescription] = useState("Annual software plan");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState<"bank" | "qr" | "agent">("bank");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ checkoutUrl: string; manifestUrl: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/payment-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountMajor: Number(amount),
          currency,
          settlementCurrency: settlement,
          description,
          reference: reference || undefined,
          method,
        }),
      });
      const body = await res.json();
      if (res.ok) setResult(body);
      else setErr(body.message ?? "could not create link");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Amount">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="ora-input"
              />
            </Labeled>
            <Labeled label="Presentment currency">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="ora-input">
                {["GBP", "USD", "EUR", "SGD", "AUD"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Labeled>
          </div>
          <Labeled label="Merchant receives">
            <select value={settlement} onChange={(e) => setSettlement(e.target.value)} className="ora-input">
              {["SGD", "GBP", "USD", "EUR"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="ora-input" />
          </Labeled>
          <Labeled label="Reference (optional)">
            <input value={reference} onChange={(e) => setReference(e.target.value)} className="ora-input" placeholder="INV-…" />
          </Labeled>
          <Labeled label="Checkout mode">
            <div className="flex gap-2">
              {(["bank", "qr", "agent"] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMethod(m)}
                  aria-pressed={method === m}
                  className={`rounded-[4px] border px-3 py-1.5 text-[13px] ${
                    method === m ? "border-ink bg-ink text-paper" : "border-line-strong text-ink"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Labeled>
          <Button type="submit" loading={busy} full>
            Create link
          </Button>
          {err && <p className="text-[12px] text-negative">{err}</p>}
        </form>
      </Card>

      <Card className="p-5">
        <div className="text-[12px] font-medium uppercase tracking-wide text-faint">Result</div>
        {result ? (
          <div className="mt-3 space-y-3">
            <Field label="Hosted checkout" value={result.checkoutUrl} />
            <Field label="Agent manifest" value={result.manifestUrl} />
            <Hairline />
            <a
              href={result.checkoutUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block rounded-[4px] bg-ink px-4 py-2 text-[13px] font-medium text-paper"
            >
              Open checkout ↗
            </a>
          </div>
        ) : (
          <p className="mt-3 font-sans text-[15px] text-muted">
            Fill the form to generate a hosted checkout link and a machine-readable manifest URL for
            agents.
          </p>
        )}
      </Card>

      <style>{`.ora-input{width:100%;border:1px solid var(--color-line-strong);border-radius:10px;padding:8px 10px;font-size:14px;background:var(--color-card)}`}</style>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-0.5 select-all break-all font-mono text-[12px] text-ink">{value}</div>
    </div>
  );
}
