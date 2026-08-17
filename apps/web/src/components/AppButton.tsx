import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

type Variant = "primary" | "secondary";

type Props = {
  children: ReactNode;
  /** Secondary line inside the button, e.g. "coming soon". Tinted per variant so it
   *  stays legible on the green fill, where the page's muted grey would not be. */
  hint?: string;
  href?: string;
  target?: "_blank" | "_self";
  rel?: string;
  variant?: Variant;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

/**
 * The app's button, as drawn on "Add a car" and "Navigate to this charger": a full pill,
 * a solid accent fill and dark ink on top. The site used to render a translucent
 * green-to-transparent gradient with light text, which the app does not do anywhere.
 */
export function AppButton({
  children,
  hint,
  href,
  target,
  rel,
  variant = "primary",
  disabled = false,
  className,
  ariaLabel,
}: Props) {
  const base =
    "inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full px-6 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  const variants: Record<Variant, string> = {
    primary: "bg-accent text-on-accent hover:brightness-110",
    secondary:
      "app-card-2 text-foreground hover:border-border-strong hover:bg-surface",
  };

  const hintTone = variant === "primary" ? "text-on-accent/65" : "text-muted";

  return (
    <a
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      href={disabled ? undefined : href}
      target={target}
      rel={rel}
      className={cx(
        base,
        variants[variant],
        // Not dimmer than this: below ~70% the accent fill drops under 4.5:1 against
        // the dark ink it carries, and the label stops being readable.
        disabled ? "pointer-events-none opacity-70" : "",
        className
      )}
      tabIndex={disabled ? -1 : undefined}
    >
      {children}
      {hint ? <span className={cx("text-xs font-medium", hintTone)}>{hint}</span> : null}
    </a>
  );
}
