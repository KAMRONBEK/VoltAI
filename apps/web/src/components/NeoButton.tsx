import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

type Variant = "primary" | "secondary";

type Props = {
  children: ReactNode;
  href?: string;
  target?: "_blank" | "_self";
  rel?: string;
  variant?: Variant;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function NeoButton({
  children,
  href,
  target,
  rel,
  variant = "primary",
  disabled = false,
  className,
  ariaLabel,
}: Props) {
  const base =
    "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

  const variants: Record<Variant, string> = {
    primary:
      "neo-ring bg-gradient-to-b from-accent/70 to-accent/35 text-foreground hover:from-accent/85 hover:to-accent/45",
    secondary:
      "neo-card text-foreground/90 hover:text-foreground hover:border-white/25",
  };

  const disabledStyle = disabled
    ? "pointer-events-none opacity-55 grayscale"
    : "";

  return (
    <a
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      href={disabled ? undefined : href}
      target={target}
      rel={rel}
      className={cx(base, variants[variant], disabledStyle, className)}
      tabIndex={disabled ? -1 : undefined}
    >
      {children}
    </a>
  );
}

