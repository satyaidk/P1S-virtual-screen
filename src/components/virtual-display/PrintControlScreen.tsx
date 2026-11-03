"use client";

import { useState } from "react";
import { Fan, Lightbulb, LightbulbOff, Move, OctagonX, Pause, Play, RefreshCw } from "lucide-react";
import { useDisplayStore } from "@/display/display-store";
import { usePrinter, useRuntime, useCommandValidation } from "@/hooks/usePrinter";
import { prettyJobName } from "@/lib/format";
import type { CommandType } from "@/printer/commands";
import { SPEED_PRESETS } from "@/printer/state";
import { ConfirmDialog } from "./ConfirmDialog";
import { TouchButton } from "./primitives";
import { ScreenStatusBanner } from "./ScreenStatusBanner";

function usePending(type: CommandType): boolean {
  return usePrinter((s) =>
    s.requests.some((r) => r.status === "pending" && r.command.type === type),
  );
}

export function PrintControlScreen({ now }: { now: number }) {
  const runtime = useRuntime();
  const status = usePrinter((s) => s.state.status);
  const jobName = usePrinter((s) => s.state.job.name);
  const speedLevel = usePrinter((s) => s.state.speedLevel);
  const light = usePrinter((s) => s.state.chamberLight);
  const partFan = usePrinter((s) => s.state.fans.part);
  const go = useDisplayStore((s) => s.go);
  const [confirmStop, setConfirmStop] = useState(false);

  const paused = status === "paused";
  const pauseValid = useCommandValidation({ type: "pause" }, now);
  const resumeValid = useCommandValidation({ type: "resume" }, now);
  const stopValid = useCommandValidation({ type: "stop", confirmed: true }, now);
  const speedValid = useCommandValidation({ type: "set_speed", level: 2 }, now);
  const lightValid = useCommandValidation({ type: "set_chamber_light", on: !light }, now);
  const refreshValid = useCommandValidation({ type: "request_full_status" }, now);

  const pausePending = usePending("pause");
  const resumePending = usePending("resume");
  const stopPending = usePending("stop");
  const speedPending = usePending("set_speed");
  const lightPending = usePending("set_chamber_light");
  const refreshPending = usePending("request_full_status");

  const primary = paused ? resumeValid : pauseValid;
  const hint =
    !primary.ok && !stopValid.ok ? primary.reason : !speedValid.ok ? speedValid.reason : null;

  return (
    <div className="relative flex h-full flex-col">
      <ScreenStatusBanner now={now} />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        <div className="grid grid-cols-2 gap-1.5">
          <TouchButton
            variant={paused ? "primary" : "default"}
            icon={paused ? Play : Pause}
            pending={pausePending || resumePending}
            disabled={!primary.ok}
            className="h-11 text-sm"
            onClick={() => void runtime.execute(paused ? { type: "resume" } : { type: "pause" })}
            data-testid={paused ? "resume" : "pause"}
          >
            {paused ? "Resume" : "Pause"}
          </TouchButton>
          <TouchButton
            variant="danger"
            icon={OctagonX}
            pending={stopPending}
            disabled={!stopValid.ok}
            className="h-11 text-sm"
            onClick={() => setConfirmStop(true)}
            data-testid="stop"
          >
            Stop
          </TouchButton>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-2xs text-fg-muted">
            <span>Print speed</span>
            {speedPending && <span className="text-info">Changing…</span>}
          </div>
          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Print speed">
            {SPEED_PRESETS.map((preset) => (
              <TouchButton
                key={preset.level}
                role="radio"
                aria-checked={speedLevel === preset.level}
                variant={speedLevel === preset.level ? "selected" : "default"}
                disabled={!speedValid.ok || speedPending}
                className="h-10 flex-col gap-0 px-0 leading-3"
                onClick={() =>
                  speedLevel !== preset.level &&
                  void runtime.execute({ type: "set_speed", level: preset.level })
                }
                data-testid={`speed-${preset.level}`}
              >
                <span>{preset.shortLabel}</span>
                <span className="text-2xs font-medium text-fg-muted tabular">
                  {preset.percent}%
                </span>
              </TouchButton>
            ))}
          </div>
        </div>

        <div className="mt-auto grid grid-cols-4 gap-1">
          <TouchButton
            icon={light ? Lightbulb : LightbulbOff}
            pending={lightPending}
            disabled={!lightValid.ok || light === null}
            className="h-9 px-1"
            onClick={() =>
              light !== null && void runtime.execute({ type: "set_chamber_light", on: !light })
            }
            aria-label={`Chamber light ${light === null ? "unknown" : light ? "on" : "off"}`}
            data-testid="light"
          >
            {light === null ? "--" : light ? "On" : "Off"}
          </TouchButton>
          <TouchButton
            icon={Fan}
            className="h-9 px-1 tabular"
            onClick={() => go("fans")}
            data-testid="open-fans"
          >
            {partFan === null ? "Fans" : `${partFan}%`}
          </TouchButton>
          <TouchButton
            icon={Move}
            className="h-9 px-1"
            onClick={() => go("move")}
            data-testid="open-move"
          >
            Move
          </TouchButton>
          <TouchButton
            icon={RefreshCw}
            pending={refreshPending}
            disabled={!refreshValid.ok}
            className="h-9 px-1"
            onClick={() => void runtime.execute({ type: "request_full_status" })}
            data-testid="refresh"
          >
            Refresh
          </TouchButton>
        </div>
        {hint && (
          <p className="text-center text-2xs text-fg-dim" data-testid="control-hint">
            {hint}
          </p>
        )}
      </div>

      {confirmStop && (
        <ConfirmDialog
          title="Stop this print?"
          message={`“${prettyJobName(jobName)}” will be cancelled. A stopped print cannot be resumed.`}
          confirmLabel="Stop print"
          cancelLabel="Keep printing"
          onCancel={() => setConfirmStop(false)}
          onConfirm={() => {
            setConfirmStop(false);
            void runtime.execute({ type: "stop", confirmed: true });
          }}
        />
      )}
    </div>
  );
}
