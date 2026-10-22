"use client";

import { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { TouchButton } from "./primitives";

/**
 * Modal confirmation inside the 320x240 screen. The destructive action is never the default
 * focus, and the safe choice is on the left where an accidental tap is more likely.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-3">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="w-full rounded-lg border border-ink-600 bg-ink-850 p-3"
      >
        <div className="flex items-center gap-2">
          <TriangleAlert size={16} className="text-danger" aria-hidden />
          <h2 id="confirm-title" className="text-sm font-bold">
            {title}
          </h2>
        </div>
        <p id="confirm-message" className="mt-1.5 text-xs text-fg-muted">
          {message}
        </p>
        <div className="mt-3 flex gap-2">
          <TouchButton
            ref={cancelRef}
            className="h-10 flex-1"
            onClick={onCancel}
            data-testid="confirm-cancel"
          >
            {cancelLabel}
          </TouchButton>
          <TouchButton
            variant="danger"
            className="h-10 flex-1"
            onClick={onConfirm}
            data-testid="confirm-accept"
          >
            {confirmLabel}
          </TouchButton>
        </div>
      </div>
    </div>
  );
}
