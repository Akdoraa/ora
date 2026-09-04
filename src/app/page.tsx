import Link from "next/link";
import { OraWordmark } from "@/components/brand/wordmark";

/**
 * Placeholder landing — the full public product page lands in Phase 2/3.
 * Exists now so the app builds and the demo routes are reachable.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <OraWordmark className="text-2xl" />
      <h1 className="mt-10 font-sans text-5xl font-semibold tracking-tight text-ink">
        Pay by bank.
        <br />
        Processing fees, solved.
      </h1>
      <p className="mt-5 max-w-lg font-serif text-lg text-muted">
        The checkout for people and AI agents. Accept instant bank payments, settle
        globally, and keep more of every sale for a 1% processing fee.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/demo"
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
        >
          Try the live checkout
        </Link>
        <Link
          href="/dashboard"
          className="rounded-full border border-line-strong px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-sky-50"
        >
          View merchant dashboard
        </Link>
      </div>
      <p className="mt-10 font-mono text-xs text-faint">
        Ripple track · SingHacks 2026 · XRPL Testnet
      </p>
    </main>
  );
}
