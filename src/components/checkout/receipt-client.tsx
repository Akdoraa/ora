"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ReceiptClient({ intentId }: { intentId: string }) {
  const [sent, setSent] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 px-6 py-4">
      <span className="text-[13px] text-muted">
        {sent ? "Receipt emailed to procurement@kestrel-digital.example" : "Email a copy of this receipt"}
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={sent}
        onClick={() => {
          // demo behaviour — records the action, no real mail sent
          navigator.clipboard
            ?.writeText(`${window.location.origin}/checkout/${intentId}/receipt`)
            .catch(() => {});
          setSent(true);
        }}
      >
        {sent ? "Sent ✓" : "Email receipt"}
      </Button>
    </div>
  );
}
