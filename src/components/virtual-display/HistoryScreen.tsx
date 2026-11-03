"use client";

import { useState } from "react";
import Image from "next/image";
import { Box, CircleCheck, CircleX, LoaderCircle, RefreshCw } from "lucide-react";
import { useDisplayStore } from "@/display/display-store";
import { usePrinter } from "@/hooks/usePrinter";
import { usePrintHistory } from "@/hooks/usePrintHistory";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { PublicTask } from "@/printer/history";
import { SubHeader } from "./primitives";

/**
 * Recent prints with their plate previews, like the P2S "Print history" list. Data comes from
 * Bambu Cloud (the printer does not publish history over MQTT), so it needs an account sign-in.
 */
export function HistoryScreen() {
  const back = useDisplayStore((s) => s.back);
  const live = usePrinter((s) => s.state.source === "live");
  const [refresh, setRefresh] = useState(0);
  const history = usePrintHistory(live ? `history-${refresh}` : null, 10);

  return (
    <div className="flex h-full flex-col">
      <SubHeader
        title="Print history"
        onBack={back}
        right={
          live ? (
            <button
              type="button"
              aria-label="Reload history"
              onClick={() => setRefresh((n) => n + 1)}
              className="touch flex size-7 items-center justify-center text-fg-muted"
              data-testid="history-reload"
            >
              <RefreshCw size={13} aria-hidden />
            </button>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="history-list">
        {!live ? (
          <Empty text="Print history comes from Bambu Cloud — connect a real printer." />
        ) : history.status === "loading" || history.status === "idle" ? (
          <div className="flex h-full items-center justify-center text-fg-muted">
            <LoaderCircle size={20} className="spin" aria-hidden />
          </div>
        ) : history.status === "error" ? (
          <Empty text={history.message} tone="danger" />
        ) : history.tasks.length === 0 ? (
          <Empty text="No cloud prints yet. Prints from the SD card are not listed." />
        ) : (
          <ul className="divide-y divide-ink-700">
            {history.tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Empty({ text, tone }: { text: string; tone?: "danger" }) {
  return (
    <p
      className={cn(
        "flex h-full items-center justify-center px-6 text-center text-2xs",
        tone === "danger" ? "text-danger" : "text-fg-muted",
      )}
      data-testid="history-empty"
    >
      {text}
    </p>
  );
}

const STATUS_LABEL: Record<PublicTask["status"], string> = {
  printing: "Printing",
  finished: "Finished",
  failed: "Failed / cancelled",
  unknown: "",
};

function TaskRow({ task }: { task: PublicTask }) {
  const [broken, setBroken] = useState(false);
  const StatusIcon =
    task.status === "finished" ? CircleCheck : task.status === "failed" ? CircleX : null;
  const date = task.startTime ? new Date(task.startTime) : null;
  return (
    <li className="flex h-[44px] items-center gap-2 px-2" data-testid="history-row">
      <div className="relative size-9 shrink-0 overflow-hidden rounded border border-ink-700 bg-ink-850">
        {task.cover && !broken ? (
          <Image
            src={task.cover}
            alt=""
            fill
            sizes="36px"
            unoptimized
            loading="lazy"
            className="object-contain"
            onError={() => setBroken(true)}
          />
        ) : (
          <Box size={16} className="absolute inset-0 m-auto text-fg-dim" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1 leading-3">
        <p className="truncate text-xs font-semibold" title={task.title}>
          {task.title || "Untitled"}
          {task.plateIndex ? <span className="text-fg-dim"> · Plate {task.plateIndex}</span> : null}
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-2xs text-fg-muted tabular">
          {StatusIcon && (
            <StatusIcon
              size={10}
              aria-hidden
              className={task.status === "finished" ? "text-ok" : "text-danger"}
            />
          )}
          <span>{STATUS_LABEL[task.status]}</span>
          {date && !Number.isNaN(date.getTime()) && (
            <span>· {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right text-2xs leading-3 text-fg-muted tabular">
        <div>{formatDuration(task.costTimeSeconds)}</div>
        <div>{task.weightGrams === null ? "" : `${Math.round(task.weightGrams)} g`}</div>
      </div>
    </li>
  );
}
