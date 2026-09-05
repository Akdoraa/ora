"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Hairline, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export interface WebhookEndpointRow {
  id: string;
  url: string;
  active: boolean;
  enabledEvents: string[];
}

export function WebhookEndpoints({ endpoints }: { endpoints: WebhookEndpointRow[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  async function addEndpoint(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/webhook-endpoints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body.message ?? "could not add endpoint");
        return;
      }
      setNewSecret(body.secret);
      setUrl("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    await fetch(`/api/webhook-endpoints/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    router.refresh();
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 text-[12px] font-medium text-faint">
        Webhook endpoints
      </div>
      <Hairline />
      <div className="divide-y divide-line">
        {endpoints.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="truncate font-mono text-[12px] text-ink">{e.url}</div>
              <div className="mt-0.5 font-mono text-[10px] text-faint">
                events: {e.enabledEvents.join(", ")}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={e.active ? "positive" : "neutral"}>
                {e.active ? "active" : "paused"}
              </Badge>
              <button
                onClick={() => toggle(e.id, e.active)}
                aria-label={`${e.active ? "Pause" : "Resume"} webhook endpoint ${e.url}`}
                className="rounded-[4px] border border-line-strong px-2.5 py-1 text-[11px] text-ink-soft hover:bg-sky-50"
              >
                {e.active ? "Pause" : "Resume"}
              </button>
            </div>
          </div>
        ))}
        {endpoints.length === 0 && (
          <p className="px-5 py-4 text-[13px] text-muted">No webhook endpoints registered.</p>
        )}
      </div>
      <Hairline />
      <form onSubmit={addEndpoint} className="flex flex-wrap items-center gap-2 px-5 py-4">
        <label className="sr-only" htmlFor="webhook-endpoint-url">
          Webhook endpoint URL
        </label>
        <input
          id="webhook-endpoint-url"
          type="url"
          required
          placeholder="https://your-app.example/webhooks/ora"
          value={url}
          onChange={(ev) => setUrl(ev.target.value)}
          className="min-w-[220px] flex-1 rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-[13px] text-ink"
        />
        <Button type="submit" size="sm" loading={busy}>
          Add endpoint
        </Button>
      </form>
      {err && <p className="px-5 pb-3 text-[12px] text-negative">{err}</p>}
      {newSecret && (
        <div className="mx-5 mb-4 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2.5">
          <p className="text-[12px] font-medium text-ink">
            Signing secret (shown once — store it now):
          </p>
          <p className="mt-1 select-all break-all font-mono text-[11px] text-ink-soft">
            {newSecret}
          </p>
        </div>
      )}
    </Card>
  );
}
