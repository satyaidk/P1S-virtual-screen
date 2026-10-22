"use client";

import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { usePrinter } from "@/hooks/usePrinter";
import { cn } from "@/lib/cn";
import { COMMAND_SPECS } from "@/printer/commands";

const VISIBLE_MS = 2500;

/** Toast above the navigation bar showing the latest command's pending/success/failure state. */
export function CommandFeedback() {
  const now = useNow(250);
  const latest = usePrinter((s) => s.requests.at(-1));
  if (!latest) return null;
  const finished = latest.finishedAt !== null;
  if (finished && now - (latest.finishedAt ?? 0) > VISIBLE_MS) return null;

  const spec = COMMAND_SPECS[latest.command.type];
  const ok = latest.status === "succeeded";
  const pending = latest.status === "pending";
  const text = pending
    ? spec.pendingLabel
    : ok
      ? spec.successLabel
      : `${spec.label}: ${latest.message ?? latest.status}`;
  const Icon = pending ? LoaderCircle : ok ? CircleCheck : CircleAlert;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="command-feedback"
      data-status={latest.status}
      className={cn(
        "pointer-events-none absolute inset-x-2 bottom-1.5 z-20 flex h-[24px] items-center gap-1.5 rounded-md border px-2 text-2xs font-semibold",
        pending && "border-info bg-info-soft",
        ok && "border-ok bg-ok-soft",
        !pending && !ok && "border-danger bg-danger-soft",
      )}
    >
      <Icon size={12} strokeWidth={2.5} aria-hidden className={cn(pending && "spin")} />
      <span className="truncate">{text}</span>
    </div>
  );
}
