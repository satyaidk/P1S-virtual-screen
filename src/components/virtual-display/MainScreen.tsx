"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Box,
  CircleCheck,
  CircleX,
  Flame,
  LoaderCircle,
  Play,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useDisplayStore } from "@/display/display-store";
import { statusMeta, TONE_TEXT, type Tone } from "@/display/status-meta";
import { usePrinter, useRuntime, useCommandValidation } from "@/hooks/usePrinter";
import { useJobTask } from "@/hooks/usePrintHistory";
import {
  formatAge,
  formatClock,
  formatDuration,
  formatRemaining,
  formatTemp,
  prettyJobName,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import { deriveDisplayStatus, telemetryAgeMs } from "@/printer/state";
import type {
  ActiveFilament,
  AmsState,
  AmsTray,
  DisplayStatus,
  Temperature,
} from "@/printer/types";
import { BedIcon } from "./icons";
import { Banner, ProgressBar, StatusDot, TouchButton } from "./primitives";

function activeTray(ams: AmsState): { tray: AmsTray | null; label: string } {
  const active: ActiveFilament = ams.active;
  if (active.kind === "external") return { tray: ams.externalSpool, label: "Ext" };
  if (active.kind === "ams") {
    const tray =
      ams.units?.find((u) => u.id === active.unit)?.trays.find((t) => t.slot === active.slot) ??
      null;
    return { tray, label: `${String.fromCharCode(65 + active.unit)}${active.slot + 1}` };
  }
  return { tray: null, label: active.kind === "none" ? "None" : "--" };
}

export function MainScreen({ now }: { now: number }) {
  const runtime = useRuntime();
  const state = usePrinter((s) => s.state);
  const go = useDisplayStore((s) => s.go);
  const display = deriveDisplayStatus(state, now, runtime.staleAfterMs);

  if (display === "disconnected" || display === "connecting") {
    return (
      <OfflinePanel
        status={display}
        lastError={state.connection.lastError}
        ageMs={telemetryAgeMs(state, now)}
      />
    );
  }

  const stale = display === "stale";
  const errorAlert =
    state.alerts.find((a) => a.severity === "error") ??
    state.alerts.find((a) => a.severity === "warning");

  return (
    <div className="flex h-full flex-col">
      {stale && (
        <Banner tone="warn" icon={TriangleAlert} testId="stale-banner">
          No updates for {formatAge(telemetryAgeMs(state, now)).replace(" ago", "")} — values may be
          outdated
        </Banner>
      )}
      {!stale && errorAlert && (
        <Banner
          tone={errorAlert.severity === "error" ? "danger" : "warn"}
          icon={TriangleAlert}
          onClick={() => go("notifications")}
          testId="alert-banner"
        >
          {errorAlert.message}
        </Banner>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1.5 px-1.5 pt-1.5 pb-1.5",
          stale && "opacity-60",
        )}
      >
        <JobPanel display={display} now={now} />
        <div className="grid grid-cols-3 gap-1.5">
          <TempTile
            label="Nozzle"
            icon={Flame}
            temp={state.nozzle}
            onClick={() => go("temperature")}
            testId="tile-nozzle"
          />
          <TempTile
            label="Bed"
            icon={BedIcon}
            temp={state.bed}
            onClick={() => go("temperature")}
            testId="tile-bed"
          />
          <FilamentTile ams={state.ams} onClick={() => go("ams")} />
        </div>
      </div>
    </div>
  );
}

function OfflinePanel({
  status,
  lastError,
  ageMs,
}: {
  status: "disconnected" | "connecting";
  lastError: string | null;
  ageMs: number | null;
}) {
  const connecting = status === "connecting";
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center"
      data-testid="offline-panel"
    >
      {connecting ? (
        <LoaderCircle size={28} className="spin text-info" aria-hidden />
      ) : (
        <WifiOff size={28} className="text-danger" aria-hidden />
      )}
      <p className="text-sm font-bold">
        {connecting
          ? "Connecting to printer…"
          : lastError?.startsWith("Not connected yet")
            ? "No printer connected"
            : "Printer offline"}
      </p>
      {!connecting && <p className="text-xs text-fg-muted">{lastError ?? "No connection"}</p>}
      <p className="text-2xs text-fg-dim">Last data {formatAge(ageMs)}</p>
    </div>
  );
}

const PROGRESS_TONE: Partial<Record<DisplayStatus, Tone>> = {
  printing: "ok",
  preparing: "info",
  paused: "warn",
  finished: "ok",
  failed: "danger",
  error: "danger",
  stale: "neutral",
};

function JobPanel({ display, now }: { display: DisplayStatus; now: number }) {
  const job = usePrinter((s) => s.state.job);
  const status = usePrinter((s) => s.state.status);
  const printErrorCode = usePrinter((s) => s.state.printErrorCode);
  const ams = usePrinter((s) => s.state.ams);
  const live = usePrinter((s) => s.state.source === "live");
  const task = useJobTask({ live, name: job.name, startedAt: job.startedAt });
  const meta = statusMeta(display, { printErrorCode });
  const printMeta = statusMeta(status, { printErrorCode });

  if (status === "idle" || status === "unknown")
    return <IdlePanel unknown={status === "unknown"} now={now} />;

  const tone = PROGRESS_TONE[display] ?? "neutral";
  const done = status === "finished";
  const failed = status === "failed";
  const paused = status === "paused";
  const remaining = job.remainingSeconds;
  const eta =
    remaining !== null && status === "printing" ? formatClock(now + remaining * 1000) : null;

  // Same hierarchy as Bambu Handy: model name, then the print profile, then plate / layer.
  const jobTitle = prettyJobName(job.name);
  const title = task?.designTitle ?? (task?.title || jobTitle);
  const filament = activeTray(ams).tray;
  const filamentLine =
    [filament?.material, filament && activeTray(ams).label].filter(Boolean).join(" · ") || null;
  // Second line: the profile name, unless it just repeats the title (then the filament).
  const subtitle =
    [task?.designTitle ? task.title : null, job.name ? jobTitle : null, filamentLine].find(
      (c): c is string => !!c && !sameText(c, title),
    ) ?? null;
  const plate = task?.plateIndex ? `Plate ${task.plateIndex}` : null;
  // While preparing, nothing of this job is printed yet: the printer may still report the
  // previous job's 100 % / last layer / 0 min until the first layer starts (Handy shows 0 %).
  const preparing = status === "preparing";
  const progress = preparing ? 0 : job.progress;
  const layer = preparing && job.totalLayers ? 0 : job.layer;
  const layers = layer !== null && job.totalLayers ? `Layer ${layer}/${job.totalLayers}` : null;
  const detail = [plate, layers].filter(Boolean).join(" · ") || null;

  const stageText = done || failed ? printMeta.label : (job.stage ?? meta.label);
  const ResultIcon: LucideIcon | null = done ? CircleCheck : failed ? CircleX : null;
  const rightText = done
    ? `Total ${formatDuration(job.elapsedSeconds)}`
    : failed
      ? "--"
      : preparing && (remaining === null || remaining <= 0)
        ? "--"
        : formatRemaining(remaining);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1.5"
      data-testid="job-panel"
    >
      <div className="flex min-h-0 gap-2">
        <Thumbnail cover={task?.cover ?? null} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p
            className="truncate text-[13px] leading-4 font-bold"
            title={task?.designTitle ?? job.name ?? undefined}
            data-testid="job-name"
          >
            {title}
          </p>
          {subtitle && (
            <p className="truncate text-2xs leading-4 text-fg-muted" data-testid="job-subtitle">
              {subtitle}
            </p>
          )}
          {detail && (
            <p
              className="truncate text-2xs leading-4 text-fg-muted tabular"
              data-testid="job-detail"
            >
              {detail}
            </p>
          )}
          <div className="mt-auto flex items-end justify-between gap-1">
            <span className="text-[24px] leading-6 font-bold tabular" data-testid="job-progress">
              {progress === null ? "--" : progress}
              <span className="text-xs font-semibold">%</span>
            </span>
            <span
              className="truncate pb-0.5 text-2xs font-semibold text-fg tabular"
              data-testid="job-remaining"
            >
              {rightText}
            </span>
          </div>
        </div>
      </div>
      <ProgressBar value={progress} tone={tone} />
      <div className="flex items-center gap-1 text-2xs leading-3 text-fg-muted tabular">
        {ResultIcon ? (
          <ResultIcon size={10} strokeWidth={2.5} aria-hidden className={TONE_TEXT[tone]} />
        ) : (
          <StatusDot tone={tone} className="size-1.5" />
        )}
        <span className="min-w-0 flex-1 truncate" data-testid="job-stage">
          {stageText}
        </span>
        <span className="shrink-0 text-fg-dim" data-testid="job-elapsed">
          {formatDuration(job.elapsedSeconds)}
        </span>
        <span className="shrink-0 text-fg-dim">· {footerHint({ eta, done, failed, paused })}</span>
      </div>
    </div>
  );
}

/** Equal ignoring case, spacing and punctuation ("Hello  Kitty!" == "hello kitty"). */
function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  return norm(a) === norm(b) || norm(a).startsWith(norm(b)) || norm(b).startsWith(norm(a));
}

function footerHint({
  eta,
  done,
  failed,
  paused,
}: {
  eta: string | null;
  done: boolean;
  failed: boolean;
  paused: boolean;
}) {
  if (done) return "Remove print";
  if (failed) return "Clear plate";
  if (paused) return "Paused";
  return eta ? `Done ${eta}` : "No ETA";
}

function IdlePanel({ unknown, now }: { unknown: boolean; now: number }) {
  const runtime = useRuntime();
  const canSimulate = runtime.provider.capabilities.commands.has("start_sample_job");
  const validation = useCommandValidation({ type: "start_sample_job" }, now);
  const pending = usePrinter((s) =>
    s.requests.some((r) => r.status === "pending" && r.command.type === "start_sample_job"),
  );

  return (
    <div className="flex min-h-0 flex-1 items-center gap-3" data-testid="idle-panel">
      <Thumbnail empty />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-bold">{unknown ? "Waiting for status…" : "Ready to print"}</p>
        <p className="text-2xs text-fg-muted">
          {canSimulate
            ? "Start the simulated sample job:"
            : "Send a print from Bambu Studio or Handy."}
        </p>
        {canSimulate && (
          <TouchButton
            variant="primary"
            icon={Play}
            pending={pending}
            disabled={!validation.ok}
            onClick={() => void runtime.execute({ type: "start_sample_job" })}
            data-testid="start-sample"
            className="h-9 self-start px-3"
          >
            Start sample print
          </TouchButton>
        )}
      </div>
    </div>
  );
}

/**
 * Job preview. The P1S does not publish thumbnails over MQTT, so `cover` comes from the Bambu
 * Cloud print task (see useJobCover). Falls back to the placeholder when there is no cover (demo
 * mode, SD-card/LAN-only prints, not signed in) or the image fails to load.
 */
const IMAGE_RETRIES = 3;
const IMAGE_RETRY_MS = 20_000;

function Thumbnail({ empty = false, cover = null }: { empty?: boolean; cover?: string | null }) {
  // A failed load is retried a few times (cache-busted): a just-started print's cover may not
  // be downloadable yet, and Bambu's CDN occasionally errors.
  const [failure, setFailure] = useState<{ cover: string; count: number } | null>(null);
  const failures = failure?.cover === cover ? failure.count : 0;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!cover || failures === 0 || failures > IMAGE_RETRIES) return;
    const t = setTimeout(() => setRetry((r) => r + 1), IMAGE_RETRY_MS);
    return () => clearTimeout(t);
  }, [cover, failures]);

  if (cover && failures <= IMAGE_RETRIES && !(failures > 0 && retry < failures)) {
    const src = failures > 0 ? `${cover}${cover.includes("?") ? "&" : "?"}r=${failures}` : cover;
    return (
      <div
        className="thumb-tile relative size-[76px] shrink-0 overflow-hidden rounded-lg"
        data-testid="job-cover"
      >
        <Image
          key={src}
          src={src}
          alt="Print preview"
          fill
          sizes="76px"
          // Authenticated, per-user image proxied by our own API route: skip the optimizer.
          unoptimized
          className="object-contain p-1"
          onError={() => setFailure({ cover, count: failures + 1 })}
        />
      </div>
    );
  }
  return (
    <div
      className="thumb-tile flex size-[76px] shrink-0 flex-col items-center justify-center rounded-lg"
      aria-hidden
      data-testid="job-cover-placeholder"
    >
      <Box size={30} strokeWidth={1.5} className={empty ? "text-fg-dim" : "text-fg-muted"} />
    </div>
  );
}

function TempTile({
  label,
  icon: Icon,
  temp,
  onClick,
  testId,
}: {
  label: string;
  icon: LucideIcon | typeof BedIcon;
  temp: Temperature;
  onClick: () => void;
  testId: string;
}) {
  const heating = temp.target !== null && temp.target > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="touch flex h-[40px] flex-col justify-center rounded-md border border-ink-700 bg-ink-850 px-2 text-left"
    >
      <span className="flex items-center gap-1 text-2xs text-fg-muted">
        <Icon
          size={11}
          strokeWidth={2.25}
          aria-hidden
          className={heating ? "text-warn" : undefined}
        />
        {label}
      </span>
      <span className="tabular">
        <span className="text-base leading-5 font-bold">{formatTemp(temp.current)}°</span>
        <span className="text-2xs text-fg-muted">
          {" "}
          /{heating ? `${formatTemp(temp.target)}°` : temp.target === null ? "--" : "off"}
        </span>
      </span>
    </button>
  );
}

function FilamentTile({ ams, onClick }: { ams: AmsState; onClick: () => void }) {
  const { tray, label } = activeTray(ams);
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="tile-filament"
      className="touch flex h-[40px] flex-col justify-center rounded-md border border-ink-700 bg-ink-850 px-2 text-left"
    >
      <span className="text-2xs text-fg-muted">Filament {label}</span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 rounded-full border border-ink-500",
            !tray?.color && "unknown-swatch",
          )}
          style={tray?.color ? { backgroundColor: tray.color } : undefined}
        />
        <span className="truncate text-sm leading-5 font-bold">{tray?.material ?? "--"}</span>
      </span>
    </button>
  );
}
