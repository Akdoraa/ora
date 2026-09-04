import { Badge } from "@/components/ui/primitives";

const TONE: Record<string, "positive" | "negative" | "warning" | "sky" | "neutral"> = {
  delivered: "positive",
  paid: "positive",
  settling: "sky",
  x402_quote_paid: "sky",
  bank_confirmed: "sky",
  awaiting_agent_approval: "warning",
  awaiting_bank_authorization: "sky",
  route_selected: "sky",
  awaiting_route: "sky",
  created: "neutral",
  partially_refunded: "warning",
  refunded: "neutral",
  cancelled: "neutral",
  expired: "neutral",
  authorization_failed: "negative",
  payment_failed: "negative",
  settlement_failed: "negative",
  fulfilment_failed: "negative",
};

export function StatusPill({ status }: { status: string }) {
  return <Badge tone={TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}
