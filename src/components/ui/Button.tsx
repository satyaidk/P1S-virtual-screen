import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "default" | "primary" | "danger" | "active" | "ghost";

const VARIANTS: Record<Variant, string> = {
  default: "border-line-strong bg-surface-raised text-fg hover:border-fg-dim",
  primary: "border-ok bg-ok text-ink-950 hover:brightness-110",
  danger: "border-danger/60 bg-danger-soft text-fg hover:border-danger",
  active: "border-mat-ink bg-mat text-fg",
  ghost: "border-transparent bg-transparent text-fg-muted hover:bg-surface-raised hover:text-fg",
};

/** Development-console button (desktop sizing; not used inside the virtual display). */
export function Button({
  variant = "default",
  className,
  ...rest
}: ComponentPropsWithRef<"button"> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,border-color,filter]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mat-ink",
        "disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-fg-dim disabled:brightness-100",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

export interface SegmentItem<T extends string | number> {
  value: T;
  label: string;
  testId?: string;
  disabled?: boolean;
}

/** A row of mutually exclusive options that reads as one control (zoom, speed, log view). */
export function Segmented<T extends string | number>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: SegmentItem<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full overflow-x-auto rounded-md border border-line bg-bench p-0.5",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            data-testid={item.testId}
            className={cn(
              "h-7 shrink-0 rounded-[5px] px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-mat-ink",
              "disabled:cursor-not-allowed disabled:text-fg-dim/60",
              active
                ? "bg-surface-raised text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                : "text-fg-muted hover:text-fg",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
