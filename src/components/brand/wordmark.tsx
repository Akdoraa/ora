import { cn } from "@/lib/utils";

/**
 * The Ora lightning-bolt mark + lowercase wordmark, matching the pitch deck.
 * Monochrome; inherits `currentColor` so it works on any surface.
 */
export function OraMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("h-6 w-6", className)}
      fill="currentColor"
    >
      <path d="M13.9 2.2c.5-.2 1 .3.8.8l-2.4 6.1a.6.6 0 0 0 .55.82h4.3c.55 0 .82.67.43 1.06L9.4 21.6c-.4.4-1.06.02-.9-.52l2.2-6.86a.6.6 0 0 0-.57-.78H5.7a.6.6 0 0 1-.43-1.02z" />
    </svg>
  );
}

export function OraWordmark({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-ink", className)}>
      <OraMark className={cn("h-[1.1em] w-[1.1em]", markClassName)} />
      <span className="font-sans text-[1.15em] font-semibold lowercase tracking-tight">
        ora
      </span>
    </span>
  );
}
