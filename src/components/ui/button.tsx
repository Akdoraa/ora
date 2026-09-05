import { forwardRef } from "react";
import Link, { type LinkProps } from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-soft disabled:bg-faint",
  secondary:
    "border border-line-strong bg-card text-ink hover:bg-sky-50 disabled:text-faint",
  ghost: "text-ink hover:bg-sky-50 disabled:text-faint",
  danger: "bg-negative text-white hover:opacity-90",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

export function buttonClasses(opts: {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  className?: string;
}) {
  const { variant = "primary", size = "md", full, className } = opts;
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[4px] font-medium transition",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500",
    "disabled:cursor-not-allowed",
    VARIANT[variant],
    SIZE[size],
    full && "w-full",
    className,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  full?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, full, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={buttonClasses({ variant, size, full, className })}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
});

/**
 * A navigation control styled exactly like Button, but a single real <a>
 * (via next/link) — never a <button> nested inside a link. Use this instead
 * of `<Link href="…"><Button>…</Button></Link>`, which is invalid HTML
 * (interactive content inside interactive content) and gives keyboard/screen-
 * reader users two stacked stops for one destination.
 */
export interface LinkButtonProps
  extends LinkProps,
    Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
}

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { className, variant = "primary", size = "md", full, children, ...props },
  ref,
) {
  return (
    <Link
      ref={ref}
      className={buttonClasses({ variant, size, full, className })}
      {...props}
    >
      {children}
    </Link>
  );
});
