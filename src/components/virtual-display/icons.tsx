/** Heated-bed icon in Lucide's style (Lucide has no bed-plate glyph). */
export function BedIcon({
  size = 14,
  strokeWidth = 2,
  ...rest
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      {...rest}
    >
      <path d="M3 17h18M5 20h14M8 7c0 2 2 2 2 4M12 5c0 2 2 2 2 4M16 7c0 2 2 2 2 4" />
    </svg>
  );
}
