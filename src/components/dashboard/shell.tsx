import Link from "next/link";
import { OraWordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils";

const NAV = [
  ["Overview", "/dashboard"],
  ["Payments", "/dashboard/payments"],
  ["Settlements", "/dashboard/settlements"],
  ["Payment links", "/dashboard/payment-links"],
  ["Developers", "/dashboard/developers"],
  ["Agent console", "/dashboard/agent-console"],
] as const;

export function DashboardShell({
  children,
  active,
  title,
  action,
}: {
  children: React.ReactNode;
  active: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-6">
            <Link href="/">
              <OraWordmark className="text-[15px] text-ink" />
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[13px] transition",
                    active === href
                      ? "bg-ink text-paper"
                      : "text-muted hover:bg-sky-50 hover:text-ink",
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <span className="font-mono text-[11px] text-faint">Marina Analytics · demo</span>
        </div>
        {/* mobile: the pill nav above is hidden below md, so it needs a reachable
            equivalent here — a horizontally-scrollable strip, not a dead end. */}
        <nav
          aria-label="Dashboard sections"
          className="flex gap-1 overflow-x-auto px-6 pb-3 md:hidden"
        >
          {NAV.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[13px] transition",
                active === href
                  ? "bg-ink text-paper"
                  : "border border-line-strong text-muted hover:bg-sky-50 hover:text-ink",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h1 className="font-sans text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {action}
        </div>
        {children}
      </main>
    </div>
  );
}
