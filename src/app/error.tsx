"use client";

import { useEffect } from "react";
import Link from "next/link";
import { OraWordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-6">
      <div className="max-w-md text-center">
        <OraWordmark className="mx-auto mb-8 justify-center text-lg text-ink" />
        <h1 className="font-sans text-2xl font-semibold tracking-tight text-ink">
          Something went wrong
        </h1>
        <p className="mt-2 font-serif text-[15px] text-muted">
          This didn&rsquo;t affect any payment in flight — nothing here moves money on its own. Try
          again, or head back to the dashboard.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-faint">ref: {error.digest}</p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="secondary" onClick={() => reset()}>
            Try again
          </Button>
          <Link href="/dashboard">
            <Button>Go to dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
