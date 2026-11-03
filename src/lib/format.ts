/** Formatting helpers shared by the virtual display and console. Pure and locale-stable. */

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) return "--";
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
  return `${s}s`;
}

/** Handy-style remaining time: "About 15min left", "About 1h 05min left". */
export function formatRemaining(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) return "--";
  const minutes = Math.max(0, Math.round(totalSeconds / 60));
  if (minutes < 1) return "Less than 1min left";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `About ${h}h ${m.toString().padStart(2, "0")}min left` : `About ${m}min left`;
}

export function formatTemp(value: number | null): string {
  return value === null ? "--" : Math.round(value).toString();
}

export function formatPercent(value: number | null): string {
  return value === null ? "--" : `${Math.round(value)}%`;
}

/** Shows only the last 4 characters of a serial: "•••••••••••0001". */
export function maskSerial(serial: string | null): string {
  if (!serial) return "Not reported";
  const visible = serial.slice(-4);
  return `${"•".repeat(Math.max(0, serial.length - 4))}${visible}`;
}

export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function formatAge(ms: number | null): string {
  if (ms === null) return "never";
  const s = Math.floor(ms / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** Truncate in the middle so both the start and the distinguishing suffix stay visible. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/** Readable job name: drop extension and replace underscores. */
export function prettyJobName(name: string | null): string {
  if (!name) return "Untitled job";
  return name.replace(/\.(gcode|3mf)$/i, "").replace(/_/g, " ");
}

export function wifiBars(dbm: number | null): 0 | 1 | 2 | 3 | null {
  if (dbm === null) return null;
  if (dbm >= -55) return 3;
  if (dbm >= -67) return 2;
  if (dbm >= -80) return 1;
  return 0;
}
