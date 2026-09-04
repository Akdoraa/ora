import Link from "next/link";
import { OraWordmark } from "@/components/brand/wordmark";
import { LinkButton } from "@/components/ui/button";

const PROOF = [
  "1% processing fee",
  "Bank or QR checkout",
  "Instant confirmation",
  "Global XRPL settlement",
  "Fewer card failures",
  "Human & agent compatible",
  "One API integration",
];

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <OraWordmark className="text-lg text-ink" />
        <nav className="flex items-center gap-5 text-sm text-muted">
          <Link href="/dashboard" className="hover:text-ink">
            Dashboard
          </Link>
          <Link href="/dashboard/developers" className="hover:text-ink">
            Developers
          </Link>
          <Link
            href="/demo"
            className="rounded-full bg-ink px-4 py-1.5 text-[13px] font-medium text-paper hover:bg-ink-soft"
          >
            Live checkout
          </Link>
        </nav>
      </header>

      {/* hero */}
      <section className="mx-auto max-w-5xl px-6 pt-16 pb-14 sm:pt-24">
        <h1 className="max-w-3xl font-sans text-[44px] font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl">
          Pay by bank.
          <br />
          Processing fees, solved.
        </h1>
        <p className="mt-6 max-w-xl font-serif text-lg leading-relaxed text-ink-soft">
          The checkout for people and AI agents. Accept instant bank payments, settle
          globally, and keep more of every sale for a 1% processing fee.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/demo" size="lg">
            Try the live checkout
          </LinkButton>
          <LinkButton href="/dashboard" size="lg" variant="secondary">
            View merchant dashboard
          </LinkButton>
        </div>

        <ul className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 font-mono text-[12px] text-muted">
          {PROOF.map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-lime-deep" />
              {p}
            </li>
          ))}
        </ul>
      </section>

      {/* two-step */}
      <section className="border-t border-line bg-card">
        <div className="mx-auto grid max-w-5xl gap-10 px-6 py-16 sm:grid-cols-2">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <OraWordmark className="text-[15px] text-ink" />
              <span className="font-mono text-[11px] uppercase text-faint">2 steps</span>
            </div>
            {[
              ["Step 1", "Link a bank account or scan a QR."],
              ["Step 2", "Review the amount and authorize. Done."],
            ].map(([s, t]) => (
              <div key={s} className="border-t border-line py-3">
                <div className="text-sm font-semibold text-ink">{s}</div>
                <div className="font-serif text-[15px] text-ink-soft">{t}</div>
              </div>
            ))}
          </div>
          <div className="opacity-60">
            <div className="mb-4 font-sans text-[15px] font-semibold text-ink">Card checkout</div>
            {[
              ["Step 1", "Find your card."],
              ["Step 2", "Type the card number."],
              ["Step 3", "Type the expiry."],
              ["Step 4", "Type the CVC."],
              ["Step 5", "Hope it authorizes, then pay."],
            ].map(([s, t]) => (
              <div key={s} className="border-t border-line py-2">
                <div className="text-[13px] font-semibold text-muted">{s}</div>
                <div className="font-serif text-sm text-muted">{t}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* agent angle */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="font-sans text-2xl font-semibold tracking-tight text-ink">
          The same checkout, for autonomous agents
        </h2>
        <p className="mt-3 max-w-2xl font-serif text-[17px] leading-relaxed text-ink-soft">
          Give an agent an objective — “pay this invoice today, the merchant must receive SGD,
          keep cost under 1%, settle in 60 seconds.” Ora’s agent parses it into hard
          constraints, discovers and compares qualified routes, buys a signed FX quote over{" "}
          <span className="font-mono text-[14px]">x402</span>, waits for your approval where your
          policy requires it, and settles on XRPL — with every decision and transaction
          traceable.
        </p>
        <div className="mt-6">
          <Link href="/demo" className="text-sm font-medium text-brand hover:underline">
            Watch the agent run the demo →
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-8 font-mono text-[12px] text-faint sm:flex-row sm:justify-between">
          <span>Ora — Ripple track, SingHacks 2026. XRPL Testnet.</span>
          <span>Sandbox bank rail · not a licensed institution.</span>
        </div>
      </footer>
    </div>
  );
}
