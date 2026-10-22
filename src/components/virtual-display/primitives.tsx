"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { ChevronLeft, LoaderCircle, type LucideIcon } from "lucide-react";
import { TONE_BG, TONE_SOFT_BG, TONE_TEXT, type Tone } from "@/display/status-meta";
import { cn } from "@/lib/cn";

type Variant = "default" | "primary" | "danger" | "ghost" | "selected";

const VARIANTS: Record<Variant, string> = {
  default: "bg-ink-800 border-ink-600 text-fg",
  primary: "bg-ok-soft border-ok text-fg",
  danger: "bg-danger-soft border-danger text-fg",
  ghost: "bg-transparent border-transparent text-fg-muted",
  selected: "bg-info-soft border-info text-fg",
};

export interface TouchButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: Variant;
  icon?: LucideIcon;
  pending?: boolean;
  children?: ReactNode;
}

/** Display button: >= 36px tall targets, explicit pressed/disabled/pending states. */
export function TouchButton({
  variant = "default",
  icon: Icon,
  pending = false,
  disabled,
  className,
  children,
  ...rest
}: TouchButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        "touch flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-semibold",
        "disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-850 disabled:text-fg-dim",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {pending ? (
        <LoaderCircle size={14} className="spin" aria-hidden />
      ) : Icon ? (
        <Icon size={14} strokeWidth={2.25} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", TONE_BG[tone], className)}
    />
  );
}

export function Banner({
  tone,
  icon: Icon,
  children,
  onClick,
  testId,
}: {
  tone: Tone;
  icon?: LucideIcon;
  children: ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  const content = (
    <>
      {Icon && (
        <Icon size={12} strokeWidth={2.5} aria-hidden className={cn("shrink-0", TONE_TEXT[tone])} />
      )}
      <span className="truncate">{children}</span>
    </>
  );
  const classes = cn(
    "flex h-[20px] w-full shrink-0 items-center gap-1.5 px-2 text-2xs font-semibold text-fg",
    TONE_SOFT_BG[tone],
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn("touch text-left", classes)}
      data-testid={testId}
    >
      {content}
    </button>
  ) : (
    <div role="status" className={classes} data-testid={testId}>
      {content}
    </div>
  );
}

/** Thin progress bar with a status tone. */
export function ProgressBar({ value, tone }: { value: number | null; tone: Tone }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700"
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", TONE_BG[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SubHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="flex h-[30px] shrink-0 items-center border-b border-ink-700 pr-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="touch flex h-full w-11 items-center justify-center text-fg-muted"
      >
        <ChevronLeft size={18} strokeWidth={2.5} aria-hidden />
      </button>
      <h2 className="flex-1 truncate text-xs font-semibold">{title}</h2>
      {right}
    </div>
  );
}
