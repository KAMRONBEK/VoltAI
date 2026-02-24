import { cx } from "@/lib/cx";

type Props = {
  className?: string;
};

export function VoltMark({ className }: Props) {
  return (
    <span className={cx("volt-mark", className)} aria-hidden="true">
      <svg
        className="volt-bolt"
        width="20"
        height="20"
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M292 96L164 296h92l-20 120 152-232h-96z"
          stroke="currentColor"
          strokeWidth="28"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Animated stroke overlay for electricity effect. */}
        <path
          data-anim="dash"
          d="M292 96L164 296h92l-20 120 152-232h-96z"
          stroke="currentColor"
          strokeWidth="28"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>
    </span>
  );
}

