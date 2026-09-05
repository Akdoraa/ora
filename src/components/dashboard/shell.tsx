import Link from "next/link";
import { OraWordmark } from "@/components/brand/wordmark";
import { Avatar } from "@/components/dashboard/kit";
import {
  OverviewIcon,
  PaymentsIcon,
  SettlementsIcon,
  LinkIcon,
  DevelopersIcon,
  AgentIcon,
} from "@/components/dashboard/nav-icons";
import { cn } from "@/lib/utils";

const NAV = [
  ["Overview", "/dashboard", OverviewIcon],
  ["Payments", "/dashboard/payments", PaymentsIcon],
  ["Settlements", "/dashboard/settlements", SettlementsIcon],
  ["Payment links", "/dashboard/payment-links", LinkIcon],
  ["Developers", "/dashboard/developers", DevelopersIcon],
  ["Agent console", "/dashboard/agent-console", AgentIcon],
] as const;

const MERCHANT_NAME = "Marina Analytics";
const MERCHANT_INITIALS = MERCHANT_NAME.split(" ")
  .map((w) => w[0])
  .join("")
  .slice(0, 2);

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
    <div className="ora-dash flex min-h-dvh bg-paper">
      {/* Sidebar — the dash-template's own Sidebar + NavItem "Cell" pattern
          (node 3898:76657 / 3896:138216): icon + label, selected item on a
          white card with an accent-coloured label. */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-card md:flex">
        <div className="px-5 py-5">
          <Link href="/">
            <OraWordmark className="text-[15px] text-ink" />
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map(([label, href, Icon]) => {
            const isActive = active === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-[15px] font-medium transition",
                  isActive
                    ? "border border-line bg-white text-[var(--dc-purple-dark)]"
                    : "text-muted hover:bg-sky-50 hover:text-ink",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-line px-5 py-4">
          <Avatar initials={MERCHANT_INITIALS} size={32} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-ink">{MERCHANT_NAME}</div>
            <div className="font-mono text-[11px] text-faint">demo</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile: the sidebar above is hidden below md, so it needs a
            reachable equivalent here — a horizontally-scrollable strip. */}
        <header className="border-b border-line bg-card md:hidden">
          <div className="flex items-center justify-between px-5 py-3.5">
            <Link href="/">
              <OraWordmark className="text-[15px] text-ink" />
            </Link>
            <Avatar initials={MERCHANT_INITIALS} size={28} />
          </div>
          <nav aria-label="Dashboard sections" className="flex gap-1 overflow-x-auto px-5 pb-3">
            {NAV.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "shrink-0 rounded-[360px] px-3 py-1.5 text-[13px] font-medium transition",
                  active === href
                    ? "bg-[var(--dc-purple-dark)] text-white"
                    : "border border-line-strong text-muted hover:bg-sky-50 hover:text-ink",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8 md:px-10">
          <div className="mb-6 flex items-end justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
            {action}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
