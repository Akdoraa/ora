"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/format";

export interface WebhookDeliveryRow {
  id: string;
  eventType: string;
  signature: string;
  status: string;
  responseStatus: number | null;
  attempts: number;
  createdAt: string;
}

const TONE: Record<string, "positive" | "negative" | "warning"> = {
  delivered: "positive",
  failed: "negative",
  pending: "warning",
  retrying: "warning",
};

export function WebhookRow({ d }: { d: WebhookDeliveryRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function replay() {
    setBusy(true);
    try {
      await fetch(`/api/webhooks/deliveries/${d.id}/replay`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-line first:border-0">
      <td className="py-2 pl-5 font-mono text-[12px] text-ink">{d.eventType}</td>
      <td className="hidden py-2 font-mono text-[11px] text-faint sm:table-cell">
        {d.signature.slice(0, 28)}…
      </td>
      <td className="py-2">
        <Badge tone={TONE[d.status] ?? "neutral"}>
          {d.status} {d.responseStatus ?? ""}
        </Badge>
      </td>
      <td className="hidden py-2 text-right font-mono text-[11px] text-faint sm:table-cell">
        {d.attempts}×
      </td>
      <td className="py-2 pr-2 text-right font-mono text-[11px] text-faint">
        {fmtDateTime(d.createdAt)}
      </td>
      <td className="py-2 pr-5 text-right">
        <button
          onClick={replay}
          disabled={busy}
          className="rounded-full border border-line-strong px-2.5 py-1 text-[11px] text-ink-soft hover:bg-sky-50 disabled:opacity-50"
        >
          {busy ? "…" : "Replay"}
        </button>
      </td>
    </tr>
  );
}
