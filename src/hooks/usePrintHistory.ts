"use client";

import { useEffect, useState } from "react";
import type { PublicTask } from "@/printer/history";

export type HistoryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; tasks: PublicTask[] }
  | { status: "error"; message: string };

/**
 * Responses are cached per key for the page's lifetime: screens remount on every navigation and
 * must not re-hit Bambu Cloud each time. A new job (different key) fetches again.
 */
const cache = new Map<string, Promise<PublicTask[]>>();

async function fetchTasks(limit: number): Promise<PublicTask[]> {
  const res = await fetch(`/api/bambu/tasks?limit=${limit}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { tasks?: PublicTask[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.tasks ?? [];
}

function load(key: string, limit: number): Promise<PublicTask[]> {
  let p = cache.get(key);
  if (!p) {
    p = fetchTasks(limit);
    cache.set(key, p);
    // Failures are not cached, so the next mount (or job) retries.
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** Test hook. */
export function clearPrintHistoryCache(): void {
  cache.clear();
}

/**
 * Recent prints from Bambu Cloud. `key` = null disables fetching (demo mode, no printer).
 * Change `key` to force a refresh (e.g. when a new job starts).
 */
export function usePrintHistory(key: string | null, limit = 10): HistoryState {
  const cacheKey = key === null ? null : `${limit}:${key}`;
  // The settled result remembers which request it belongs to; anything else is "loading".
  // Deriving it during render avoids a synchronous setState inside the effect.
  const [settled, setSettled] = useState<{ key: string; state: HistoryState } | null>(null);

  useEffect(() => {
    if (cacheKey === null) return;
    let cancelled = false;
    load(cacheKey, limit).then(
      (tasks) => !cancelled && setSettled({ key: cacheKey, state: { status: "ready", tasks } }),
      (e: unknown) =>
        !cancelled &&
        setSettled({
          key: cacheKey,
          state: { status: "error", message: e instanceof Error ? e.message : String(e) },
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [cacheKey, limit]);

  if (cacheKey === null) return { status: "idle" };
  return settled?.key === cacheKey ? settled.state : { status: "loading" };
}

/**
 * Cover image of the job on the printer. The printer itself never sends it (P1 firmware), so it
 * comes from the newest Bambu Cloud task of this printer — the same source Handy uses.
 * Returns null while loading, when unavailable, or when the newest task is a different print.
 */
export function useJobCover(job: {
  live: boolean;
  name: string | null;
  startedAt: number | null;
}): string | null {
  const key = job.live && job.name ? `${job.name}|${job.startedAt ?? ""}` : null;
  // A few entries, not 1: the server drops other printers' tasks if Bambu ignores deviceId.
  const history = usePrintHistory(key, 5);
  if (history.status !== "ready") return null;
  const latest = history.tasks[0];
  if (!latest?.cover) return null;
  return taskMatchesJob(latest, job) ? latest.cover : null;
}

/**
 * Guard against showing the previous print's picture: when the job reports a start time, the
 * newest task must have started within a few minutes of it (cloud and printer clocks differ).
 * Without a start time (some firmware), trust the newest task.
 */
export function taskMatchesJob(
  task: Pick<PublicTask, "startTime">,
  job: { startedAt: number | null },
  toleranceMs = 15 * 60_000,
): boolean {
  if (job.startedAt === null || task.startTime === null) return true;
  const started = Date.parse(task.startTime);
  if (Number.isNaN(started)) return true;
  return Math.abs(started - job.startedAt) <= toleranceMs;
}
