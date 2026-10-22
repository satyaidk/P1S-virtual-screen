"use client";

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
import { formatAge, formatClock, formatDuration, formatTemp, prettyJobName } from "@/lib/format";
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
          "flex min-h-0 flex-1 flex-col gap-1.5 px-2 pt-1.5 pb-2",
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
  const meta = statusMeta(display, { printErrorCode });
  const printMeta = statusMeta(status, { printErrorCode });

  if (status === "idle" || status === "unknown")
    return <IdlePanel unknown={status === "unknown"} now={now} />;

  const tone = PROGRESS_TONE[display] ?? "neutral";
  const done = status === "finished";
  const failed = status === "failed";
  const remaining = job.remainingSeconds;
  const eta =
    remaining !== null && status === "printing" ? formatClock(now + remaining * 1000) : null;
  const layers =
    job.layer !== null && job.totalLayers ? `Layer ${job.layer}/${job.totalLayers}` : null;
  const subline = done || failed ? printMeta.label : (job.stage ?? meta.label);
  const ResultIcon: LucideIcon | null = done ? CircleCheck : failed ? CircleX : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1" data-testid="job-panel">
      <div className="flex min-h-0 flex-1 gap-2">
        <Thumbnail />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={cn("flex items-center gap-1 text-2xs font-semibold", TONE_TEXT[tone])}>
            {ResultIcon ? (
              <ResultIcon size={11} strokeWidth={2.5} aria-hidden />
            ) : (
              <StatusDot tone={tone} />
            )}
            <span className="truncate" data-testid="job-stage">
              {subline}
            </span>
            {layers && <span className="ml-auto shrink-0 text-fg-dim tabular">{layers}</span>}
          </div>
          <p
            className="mt-0.5 line-clamp-2 text-[13px] leading-4 font-semibold break-all"
            title={job.name ?? undefined}
            data-testid="job-name"
          >
            {prettyJobName(job.name)}
          </p>
          <div className="mt-auto flex items-end justify-between">
            <span className="text-[26px] leading-7 font-bold tabular" data-testid="job-progress">
              {job.progress === null ? "--" : job.progress}
              <span className="text-sm text-fg-muted">%</span>
            </span>
            <div className="text-right text-2xs leading-3 text-fg-muted tabular">
              <div>{done ? "Total" : "Left"}</div>
              <div className="text-xs font-semibold text-fg" data-testid="job-remaining">
                {done
                  ? formatDuration(job.elapsedSeconds)
                  : failed
                    ? "--"
                    : formatDuration(remaining)}
              </div>
            </div>
          </div>
        </div>
      </div>
      <ProgressBar value={job.progress} tone={tone} />
      <div className="flex justify-between text-2xs text-fg-muted tabular">
        <span data-testid="job-elapsed">Elapsed {formatDuration(job.elapsedSeconds)}</span>
        <span>{footerHint({ eta, done, failed, paused: status === "paused" })}</span>
      </div>
    </div>
  );
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
  if (done) return "Remove print from plate";
  if (failed) return "Clear plate to restart";
  if (paused) return "Paused · ETA on resume";
  return eta ? `Done ≈ ${eta}` : "ETA not reported";
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
 * Designed placeholder. The P1S does not publish job thumbnails over MQTT (they live in the
 * .3mf on the SD card / cloud), so no image is fetched in this phase.
 */
function Thumbnail({ empty = false }: { empty?: boolean }) {
  return (
    <div
      className="flex size-[64px] shrink-0 flex-col items-center justify-center rounded-md border border-ink-700 bg-ink-850"
      aria-hidden
    >
      <Box size={26} strokeWidth={1.5} className={empty ? "text-fg-dim" : "text-fg-muted"} />
      <span className="mt-1 h-0.5 w-10 rounded bg-ink-600" />
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
      className="touch flex h-[46px] flex-col justify-center rounded-md border border-ink-700 bg-ink-850 px-2 text-left"
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
      className="touch flex h-[46px] flex-col justify-center rounded-md border border-ink-700 bg-ink-850 px-2 text-left"
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
