import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "default" | "primary" | "danger" | "active";

const VARIANTS: Record<Variant, string> = {
  default: "border-ink-600 bg-ink-800 hover:bg-ink-700",
  primary: "border-ok/70 bg-ok-soft hover:border-ok",
  danger: "border-danger/70 bg-danger-soft hover:border-danger",
  active: "border-info bg-info-soft",
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
        "h-8 rounded-md border px-2.5 text-xs font-medium text-fg transition-colors",
        "focus-visible:outline-2 focus-visible:outline-info disabled:cursor-not-allowed disabled:opacity-40",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}
