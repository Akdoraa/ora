"use client";

import { useState } from "react";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { fmtMinor } from "@/lib/format";

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "positive" | "muted";
}) {
  return (
    <Card className="p-4">
      <div className="text-[12px] font-medium text-faint">{label}</div>
      <div
        className={cn(
          "mt-1.5 font-sans text-3xl font-bold tracking-tight",
          tone === "positive" ? "text-positive" : "text-ink",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </Card>
  );
}

type KpiTone = "purple" | "blue" | "purple-dark" | "lime" | "basic";

// Colour system pulled from the dash-template Figma file's "_Sections"
// component (node 3881:66379): a badge + title row, a big value, and a
// white/tinted pill indicator, cycled across 5 brand tones.
const KPI_TONE: Record<KpiTone, { bg: string; text: string; badge: string; pill: string }> = {
  purple: { bg: "var(--dc-purple)", text: "#fff", badge: "rgba(255,255,255,0.2)", pill: "#fff" },
  blue: { bg: "var(--dc-blue)", text: "#fff", badge: "rgba(255,255,255,0.2)", pill: "#fff" },
  "purple-dark": {
    bg: "var(--dc-purple-dark)",
    text: "#fff",
    badge: "rgba(255,255,255,0.2)",
    pill: "#fff",
  },
  lime: { bg: "var(--dc-lime)", text: "var(--dc-text)", badge: "rgba(0,0,0,0.08)", pill: "#fff" },
  basic: { bg: "var(--dc-basic)", text: "var(--dc-text)", badge: "rgba(0,0,0,0.06)", pill: "#fff" },
};

export function KpiCard({
  icon,
  title,
  value,
  pill,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: React.ReactNode;
  pill?: React.ReactNode;
  tone: KpiTone;
}) {
  const t = KPI_TONE[tone];
  return (
    <div className="dc-kpi" style={{ background: t.bg, color: t.text }}>
      <div className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: t.badge }}
        >
          {icon}
        </span>
        <span className="text-[13px] font-medium opacity-90">{title}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[28px] leading-none font-bold tracking-tight">{value}</span>
        {pill && (
          <span className="dc-pill" style={{ background: t.pill, color: "var(--dc-text)" }}>
            {pill}
          </span>
        )}
      </div>
    </div>
  );
}

/** Monochrome bar chart (deck style): black bars, hairline gridlines. Hover
 * shows the dash-template's own "_Tooltip" pattern (node 2830:26263: a dark
 * rounded chip with a pointed tail) reading the real value under the
 * cursor — not decorative, every number it shows is real chart data. */
export function BarChart({
  data,
  height = 120,
  currency,
}: {
  data: { label: string; value: number }[];
  height?: number;
  /** ISO currency code — each value is major units, formatted with fmtMinor.
   * A currency string crosses the server/client boundary cleanly; a
   * formatter function doesn't (Server Components can't pass functions to
   * Client Components). */
  currency: string;
}) {
  const format = (n: number) => fmtMinor(BigInt(Math.round(n * 100)), currency);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = 100 / data.length;
  const hovered = hover !== null ? data[hover] : undefined;
  const hoveredTopPx = hovered ? height - (hovered.value / max) * (height - 8) : 0;

  return (
    <div className="w-full">
      <div className="relative w-full">
        <svg
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height }}
          onMouseLeave={() => setHover(null)}
        >
          {[0.25, 0.5, 0.75, 1].map((g) => (
            <line
              key={g}
              x1={0}
              x2={100}
              y1={height - g * (height - 8)}
              y2={height - g * (height - 8)}
              stroke="var(--color-line)"
              strokeWidth={0.5}
            />
          ))}
          {data.map((d, i) => {
            const h = (d.value / max) * (height - 8);
            return (
              <rect
                key={i}
                x={i * bw + bw * 0.28}
                y={height - h}
                width={bw * 0.44}
                height={Math.max(h, d.value > 0 ? 1 : 0)}
                fill={hover === i ? "var(--dc-purple-dark)" : "var(--color-ink)"}
                className="cursor-default transition-colors"
                onMouseEnter={() => setHover(i)}
              />
            );
          })}
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute z-10"
            style={{
              left: `${(hover! + 0.5) * bw}%`,
              top: `${hoveredTopPx - 8}px`,
              transform: "translate(-50%, -100%)",
            }}
          >
            <ChartTooltip value={format(hovered.value)} label={hovered.label} />
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
        <span>{data[0]?.label}</span>
        <span>peak {format(max)}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

function ChartTooltip({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="whitespace-nowrap rounded-2xl bg-[#010101] px-3 py-2 text-center text-white shadow-lg">
        <div className="text-[13px] leading-tight font-medium">{value}</div>
        <div className="text-[11px] leading-tight text-white/60">{label}</div>
      </div>
      <div className="-mt-1 h-2 w-2 rotate-45 bg-[#010101]" />
    </div>
  );
}
