import "server-only";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CloudRegion } from "./bambu-cloud";

/**
 * Server-side persistence for the cloud session and the chosen printer, so a restart does not
 * require signing in again. Stored in `.data/` (git-ignored) with owner-only permissions.
 * Never sent to the browser as-is — see `publicView`.
 */

export interface CloudSession {
  region: CloudRegion;
  account: string;
  token: string;
  mqttUsername: string;
  /** Epoch ms; null when the API did not say. */
  expiresAt: number | null;
}

export type PrinterTarget =
  | { mode: "cloud"; serial: string; name: string }
  | { mode: "lan"; serial: string; name: string; host: string; accessCode: string };

export interface StoredState {
  cloud: CloudSession | null;
  printer: PrinterTarget | null;
}

const EMPTY: StoredState = { cloud: null, printer: null };

export function dataDir(): string {
  return process.env.P1S_DATA_DIR ?? path.join(process.cwd(), ".data");
}

function file(): string {
  return path.join(dataDir(), "bambu-session.json");
}

export async function loadState(): Promise<StoredState> {
  try {
    const raw = JSON.parse(await readFile(file(), "utf8")) as Partial<StoredState>;
    const cloud =
      raw.cloud && raw.cloud.expiresAt !== null && raw.cloud.expiresAt < Date.now()
        ? null
        : raw.cloud;
    return { cloud: cloud ?? null, printer: raw.printer ?? null };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveState(state: StoredState): Promise<void> {
  await mkdir(dataDir(), { recursive: true, mode: 0o700 });
  await writeFile(file(), JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(file(), 0o600).catch(() => {});
}

export async function clearState(): Promise<void> {
  await rm(file(), { force: true });
}

/** "jashan@example.com" -> "ja•••@example.com" */
export function maskAccount(account: string): string {
  const [user = "", domain] = account.split("@");
  const visible = user.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(1, user.length - visible.length))}${domain ? `@${domain}` : ""}`;
}

export function maskSerial(serial: string): string {
  return `${"•".repeat(Math.max(0, serial.length - 4))}${serial.slice(-4)}`;
}
