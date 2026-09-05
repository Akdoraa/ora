import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

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

/** Monochrome bar chart (deck style): black bars, hairline gridlines. */
export function BarChart({
  data,
  height = 120,
  format = (n) => String(n),
}: {
  data: { label: string; value: number }[];
  height?: number;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = 100 / data.length;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
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
              fill="var(--color-ink)"
            />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
        <span>{data[0]?.label}</span>
        <span>peak {format(max)}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}
