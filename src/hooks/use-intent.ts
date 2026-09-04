"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TERMINAL = new Set([
  "delivered",
  "authorization_failed",
  "payment_failed",
  "settlement_failed",
  "fulfilment_failed",
  "expired",
  "cancelled",
  "refunded",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IntentAggregate = any;

export function useIntent(id: string, initial: IntentAggregate, pollMs = 1500) {
  const [data, setData] = useState<IntentAggregate>(initial);
  const [polling, setPolling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/payment-intents/${id}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      /* keep last */
    }
  }, [id]);

  const status: string = data?.intent?.status ?? "created";
  const terminal = TERMINAL.has(status);

  useEffect(() => {
    if (!polling || terminal) {
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    timer.current = setTimeout(async () => {
      await refresh();
    }, pollMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [polling, terminal, refresh, pollMs, data]);

  return {
    data,
    status,
    terminal,
    refresh,
    startPolling: () => setPolling(true),
    stopPolling: () => setPolling(false),
    setData,
  };
}
