import { cx } from "@/lib/cx";

type Props = {
  className?: string;
};

/**
 * "VoltAI" set the way the app's wordmark is drawn: "Volt" in the mid green,
 * "AI" in the pale green. Both values are sampled from
 * `apps/mobile/assets/brand/wordmark.png` and live as tokens in globals.css.
 *
 * Rendered as text rather than shipped as the PNG so it stays crisp at any size and
 * remains selectable and readable to screen readers.
 */
export function VoltWordmark({ className }: Props) {
  return (
    <span className={cx("font-semibold tracking-tight", className)}>
      <span style={{ color: "var(--wordmark-volt)" }}>Volt</span>
      <span style={{ color: "var(--wordmark-ai)" }}>AI</span>
    </span>
  );
}
