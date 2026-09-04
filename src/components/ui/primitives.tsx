import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

export function Hairline({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-line", className)} />;
}

type Tone = "neutral" | "positive" | "negative" | "warning" | "info" | "sky";
const TONE: Record<Tone, string> = {
  neutral: "bg-[#f3f1ec] text-ink-soft",
  positive: "bg-positive-bg text-positive",
  negative: "bg-negative-bg text-negative",
  warning: "bg-warning-bg text-warning",
  info: "bg-sky-100 text-sky-600",
  sky: "bg-sky-100 text-sky-600",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Row({
  label,
  value,
  strong,
  mono,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", className)}>
      <span className="text-sm text-muted">{label}</span>
      <span
        className={cn(
          "text-right text-sm",
          strong ? "font-semibold text-ink" : "text-ink-soft",
          mono && "font-mono text-[13px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function TestnetBadge() {
  return (
    <Badge tone="warning" className="font-mono lowercase tracking-normal">
      xrpl testnet
    </Badge>
  );
}
