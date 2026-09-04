"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Hairline } from "@/components/ui/primitives";

export interface PolicyEditorProps {
  policyId: string;
  policyCurrency: string;
  maxPaymentAmountMajor: number;
  maxDailySpendAmountMajor: number;
  autoApproveUnderAmountMajor: number;
  maxFxSpreadPct: number;
  maxProcessingFeePct: number;
  requiredSettlementSeconds: number;
  requireApprovalForNewPayee: boolean;
}

export function PolicyEditor(props: PolicyEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    maxPaymentAmountMajor: props.maxPaymentAmountMajor,
    maxDailySpendAmountMajor: props.maxDailySpendAmountMajor,
    autoApproveUnderAmountMajor: props.autoApproveUnderAmountMajor,
    maxFxSpreadPct: props.maxFxSpreadPct,
    maxProcessingFeePct: props.maxProcessingFeePct,
    requiredSettlementSeconds: props.requiredSettlementSeconds,
    requireApprovalForNewPayee: props.requireApprovalForNewPayee,
  });

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/agent-policies/${props.policyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxPaymentAmountMajor: form.maxPaymentAmountMajor,
          maxDailySpendAmountMajor: form.maxDailySpendAmountMajor,
          autoApproveUnderAmountMajor: form.autoApproveUnderAmountMajor,
          maxFxSpreadBps: Math.round(form.maxFxSpreadPct * 100),
          maxProcessingFeeBps: Math.round(form.maxProcessingFeePct * 100),
          requiredSettlementSeconds: form.requiredSettlementSeconds,
          requireApprovalForNewPayee: form.requireApprovalForNewPayee,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body.message ?? "could not save");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
        Edit policy
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <Hairline />
      <NumField
        label={`Max per payment (${props.policyCurrency})`}
        value={form.maxPaymentAmountMajor}
        onChange={(v) => setForm((f) => ({ ...f, maxPaymentAmountMajor: v }))}
      />
      <NumField
        label={`Max daily spend (${props.policyCurrency})`}
        value={form.maxDailySpendAmountMajor}
        onChange={(v) => setForm((f) => ({ ...f, maxDailySpendAmountMajor: v }))}
      />
      <NumField
        label={`Auto-approve under (${props.policyCurrency})`}
        value={form.autoApproveUnderAmountMajor}
        onChange={(v) => setForm((f) => ({ ...f, autoApproveUnderAmountMajor: v }))}
      />
      <NumField
        label="Max processing fee (%)"
        step={0.05}
        value={form.maxProcessingFeePct}
        onChange={(v) => setForm((f) => ({ ...f, maxProcessingFeePct: v }))}
      />
      <NumField
        label="Max FX spread (%)"
        step={0.05}
        value={form.maxFxSpreadPct}
        onChange={(v) => setForm((f) => ({ ...f, maxFxSpreadPct: v }))}
      />
      <NumField
        label="Required settlement time (seconds)"
        step={1}
        value={form.requiredSettlementSeconds}
        onChange={(v) => setForm((f) => ({ ...f, requiredSettlementSeconds: v }))}
      />
      <label className="flex items-center gap-2 text-[13px] text-ink-soft">
        <input
          type="checkbox"
          checked={form.requireApprovalForNewPayee}
          onChange={(e) =>
            setForm((f) => ({ ...f, requireApprovalForNewPayee: e.target.checked }))
          }
          className="h-3.5 w-3.5"
        />
        Require approval for a new payee
      </label>
      {err && <p className="text-[12px] text-negative">{err}</p>}
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={save} loading={busy}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-[13px] text-ink"
      />
    </label>
  );
}
