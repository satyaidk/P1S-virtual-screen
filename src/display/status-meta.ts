import { PRINT_ERROR_USER_CANCELLED } from "@/printer/protocol/mqtt-types";
import type { DisplayStatus, PrinterState } from "@/printer/types";

export type Tone = "ok" | "info" | "warn" | "danger" | "neutral";

export interface StatusMeta {
  label: string;
  tone: Tone;
}

export function statusMeta(
  status: DisplayStatus,
  state?: Pick<PrinterState, "printErrorCode">,
): StatusMeta {
  switch (status) {
    case "disconnected":
      return { label: "Offline", tone: "danger" };
    case "connecting":
      return { label: "Connecting", tone: "info" };
    case "stale":
      return { label: "No updates", tone: "warn" };
    case "error":
      return { label: "Error", tone: "danger" };
    case "idle":
      return { label: "Ready", tone: "neutral" };
    case "preparing":
      return { label: "Preparing", tone: "info" };
    case "printing":
      return { label: "Printing", tone: "ok" };
    case "paused":
      return { label: "Paused", tone: "warn" };
    case "finished":
      return { label: "Finished", tone: "ok" };
    case "failed":
      return state?.printErrorCode === PRINT_ERROR_USER_CANCELLED
        ? { label: "Cancelled", tone: "neutral" }
        : { label: "Failed", tone: "danger" };
    case "unknown":
      return { label: "Unknown", tone: "neutral" };
  }
}

/** Tailwind classes per tone (kept static so Tailwind can detect them). */
export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  info: "text-info",
  warn: "text-warn",
  danger: "text-danger",
  neutral: "text-fg-muted",
};

export const TONE_BG: Record<Tone, string> = {
  ok: "bg-ok",
  info: "bg-info",
  warn: "bg-warn",
  danger: "bg-danger",
  neutral: "bg-fg-dim",
};

export const TONE_SOFT_BG: Record<Tone, string> = {
  ok: "bg-ok-soft",
  info: "bg-info-soft",
  warn: "bg-warn-soft",
  danger: "bg-danger-soft",
  neutral: "bg-ink-800",
};
