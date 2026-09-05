import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The remaining dash-template components (figma.com/design/ZDjgp4bFWMAibD8LcsqDQy,
 * node 2894:41872), pulled via the Figma MCP connector and adapted to this
 * project's own patterns (plain props, Tailwind arbitrary values against the
 * .ora-dash tokens in globals.css) rather than the generated variant-prop
 * component. Each one below cites the exact node it came from.
 */

/** "_Chip" (node 2900:50953), Style=Active/Selected, Shape=Pill. A toggle
 * chip — used as the Payments status filter. */
export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-[360px] px-4 py-2 text-[15px] font-medium transition",
        active
          ? "bg-[#1f1f21] text-white"
          : "border border-[#e7e7e7] bg-white text-[rgba(31,31,33,0.74)] hover:bg-[rgba(31,31,33,0.04)]",
      )}
    >
      {children}
    </button>
  );
}

/** "_Tab" (node 2525:19986), State=Active/Selected, Shape=Pill: a segmented
 * track with one raised "Selected" tab. Used for the Payments status filter
 * row (a real client-side filter over the actual payment list, not decorative). */
export function TabGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-[360px] bg-[#f7f7f7] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "rounded-[360px] px-4 py-1.5 text-[13px] font-medium transition",
            value === o.value
              ? "bg-white text-[#1f1f21] shadow-sm"
              : "text-[rgba(31,31,33,0.56)] hover:text-[rgba(31,31,33,0.74)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "_Indicator" (node 2760:24537), Size=Medium/Small, Type=Primary: a small
 * rounded count badge. Used inline for a real, live count (never a fabricated
 * delta). */
export function Indicator({
  children,
  tone = "primary",
}: {
  children: React.ReactNode;
  tone?: "primary" | "black" | "white";
}) {
  const cls =
    tone === "black"
      ? "bg-[#010101] text-white"
      : tone === "white"
        ? "border border-[#e7e7e7] bg-white text-[#1f1f21]"
        : "bg-[var(--dc-blue)] text-white";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium tracking-tight",
        cls,
      )}
    >
      {children}
    </span>
  );
}

/** "_Avatar" (node 2643:15836), Size=40px, Type=Name: an initials avatar. */
export function Avatar({ initials, size = 40 }: { initials: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--dc-blue)] font-medium text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.375) }}
    >
      {initials}
    </div>
  );
}

/** "Breadcrumb" (node 3899:113168). */
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-[15px]">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2.5">
          {i > 0 && <span className="text-[rgba(31,31,33,0.56)]">/</span>}
          {item.href ? (
            <Link href={item.href} className="text-[rgba(31,31,33,0.56)] hover:text-[#1f1f21]">
              {item.label}
            </Link>
          ) : (
            <span className="truncate text-[#1f1f21]">{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
