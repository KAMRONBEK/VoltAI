import { cx } from "@/lib/cx";

type Props = {
  className?: string;
  /** Render just the bolt, without the app-icon tile around it. */
  bare?: boolean;
  size?: number;
};

/**
 * The bolt from the app icon.
 *
 * The geometry is traced from the alpha channel of `apps/mobile/assets/brand/logo.png`
 * (512x512): six vertices, the two long diagonals, and the two shelves. It is a solid
 * filled shape with a top-left-to-bottom-right green gradient — the site previously drew
 * an *outlined* bolt in a different green, which was a mark the app never used.
 *
 * The corners are rounded by stroking the same path with `stroke-linejoin: round` rather
 * than by hand-authoring arcs.
 */
export function VoltMark({ className, bare = false, size = 20 }: Props) {
  const gradientId = "volt-bolt-gradient";

  const bolt = (
    <svg
      className="volt-bolt"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="18%" y1="0%" x2="82%" y2="100%">
          <stop offset="0%" stopColor="var(--bolt-from)" />
          <stop offset="100%" stopColor="var(--bolt-to)" />
        </linearGradient>
      </defs>
      <path
        d="M291 66 L288 204 L415 203 L220 446 L223 284 L100 282 Z"
        fill={`url(#${gradientId})`}
        stroke={`url(#${gradientId})`}
        strokeWidth="18"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );

  if (bare) {
    return (
      <span className={cx("inline-flex", className)} aria-hidden="true">
        {bolt}
      </span>
    );
  }

  return (
    <span className={cx("volt-mark", className)} aria-hidden="true">
      {bolt}
    </span>
  );
}
