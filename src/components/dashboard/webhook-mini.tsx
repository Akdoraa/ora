"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/primitives";

const TONE: Record<string, "positive" | "negative" | "warning"> = {
  delivered: "positive",
  failed: "negative",
  pending: "warning",
  retrying: "warning",
};

export function WebhookMini({
  d,
}: {
  d: { id: string; eventType: string; status: string; responseStatus: number | null };
}) {
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
    <div className="flex items-center justify-between gap-2 text-[13px]">
      <span className="font-mono text-[12px] text-ink-soft">{d.eventType}</span>
      <span className="flex items-center gap-1.5">
        <Badge tone={TONE[d.status] ?? "neutral"}>
          {d.status} · {d.responseStatus ?? "—"}
        </Badge>
        {d.status !== "delivered" && (
          <button
            onClick={replay}
            disabled={busy}
            aria-label={`Replay ${d.eventType} webhook`}
            className="rounded-full border border-line-strong px-2 py-0.5 text-[10px] text-ink-soft hover:bg-sky-50 disabled:opacity-50"
          >
            {busy ? "…" : "replay"}
          </button>
        )}
      </span>
    </div>
  );
}
