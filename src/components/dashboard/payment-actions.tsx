"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

const REFUNDABLE = new Set(["paid", "delivered", "partially_refunded"]);

export function PaymentActions({
  intentId,
  status,
  checkoutUrl,
}: {
  intentId: string;
  status: string;
  checkoutUrl: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function refund() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/payment-intents/${intentId}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `refund-${intentId}` },
        body: JSON.stringify({ reason: "merchant-initiated full refund" }),
      });
      const body = await res.json();
      if (res.ok) {
        setMsg(`Refunded. ${body.xrplTxHash ? `On-chain: ${body.xrplTxHash.slice(0, 12)}…` : ""}`);
        router.refresh();
      } else {
        setMsg(body.message ?? "refund failed");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="text-[12px] font-medium uppercase tracking-wide text-faint">Actions</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={checkoutUrl} target="_blank">
          <Button size="sm" variant="secondary">
            Open checkout ↗
          </Button>
        </Link>
        <Link href={`/api/payment-intents/${intentId}/manifest`} target="_blank">
          <Button size="sm" variant="ghost">
            View manifest
          </Button>
        </Link>
        {REFUNDABLE.has(status) &&
          (confirming ? (
            <Button size="sm" variant="danger" onClick={refund} loading={busy}>
              Confirm full refund
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
              Refund
            </Button>
          ))}
      </div>
      {msg && <p className="mt-2 text-[12px] text-muted">{msg}</p>}
    </Card>
  );
}
