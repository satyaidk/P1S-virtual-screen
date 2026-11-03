import "server-only";
import type { PublicTask } from "@/printer/history";
import { BambuCloudClient, CloudError, type CloudTask } from "./bambu-cloud";

export type { PublicTask };

/**
 * Print history and job covers (the 3D plate preview) from Bambu Cloud.
 *
 * Why the cloud: a P1-series printer never sends the job thumbnail over MQTT — it lives inside the
 * .3mf. When a print is started through the cloud (Handy, Bambu Studio, MakerWorld) Bambu stores a
 * "task" with a rendered cover, which is exactly what the printer's own screen shows.
 */

/** What a signed-in session needs to read its printer's history. */
export interface CloudContext {
  client: BambuCloudClient;
  token: string;
  serial: string;
}

export const NO_CLOUD_HISTORY =
  "Print history and job previews need a Bambu account sign-in (Bambu Cloud)";

const TASK_STATUS: Record<number, PublicTask["status"]> = {
  1: "printing",
  2: "finished",
  3: "failed",
};

export function toPublicTask(task: CloudTask): PublicTask {
  return {
    id: task.id,
    title: task.title,
    designTitle: task.designTitle,
    cover: task.coverUrl ? `/api/bambu/cover?id=${encodeURIComponent(task.id)}` : null,
    status: (task.status !== null && TASK_STATUS[task.status]) || "unknown",
    plateIndex: task.plateIndex,
    startTime: task.startTime,
    endTime: task.endTime,
    weightGrams: task.weightGrams,
    costTimeSeconds: task.costTimeSeconds,
  };
}

export async function listPublicTasks(ctx: CloudContext, limit: number): Promise<PublicTask[]> {
  const tasks = await withSessionCheck(() => ctx.client.listTasks(ctx.token, ctx.serial, limit));
  return tasks.map(toPublicTask);
}

interface CachedImage {
  body: ArrayBuffer;
  contentType: string;
}

/**
 * A task's cover never changes, so bytes are cached per (printer, task). Small and bounded: this
 * is a per-process convenience (a serverless instance may drop it at any time), not a store.
 */
const MAX_CACHED = 24;
const imageCache = new Map<string, CachedImage>();

export async function fetchCover(ctx: CloudContext, taskId: string): Promise<CachedImage> {
  const key = `${ctx.serial}:${taskId}`;
  const hit = imageCache.get(key);
  if (hit) return hit;

  // Look the id up in the printer's own history: the browser can only ask for covers of tasks
  // that belong to the signed-in account's selected printer, never an arbitrary URL.
  const tasks = await withSessionCheck(() => ctx.client.listTasks(ctx.token, ctx.serial, 20));
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new CloudError("No such print on this printer", 404);
  if (!task.coverUrl) throw new CloudError("This print has no preview image", 404);

  const image = await ctx.client.fetchImage(task.coverUrl);
  imageCache.set(key, image);
  while (imageCache.size > MAX_CACHED) {
    const oldest = imageCache.keys().next().value;
    if (oldest === undefined) break;
    imageCache.delete(oldest);
  }
  return image;
}

/** Test hook. */
export function clearCoverCache(): void {
  imageCache.clear();
}

async function withSessionCheck<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CloudError && e.status === 401) {
      throw new CloudError("Bambu session expired — sign in again", 401);
    }
    throw e;
  }
}
