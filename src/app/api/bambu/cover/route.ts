import { resolveCloudContext } from "@/server/cloud-context";
import { errorResponse, json, rejectForeignRequest } from "@/server/http";
import { fetchCover } from "@/server/print-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASK_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** The cover image (sliced plate preview) of one print task, proxied from Bambu's CDN. */
export async function GET(req: Request) {
  const rejected = rejectForeignRequest(req);
  if (rejected) return rejected;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!TASK_ID.test(id)) return json({ error: "Invalid task id" }, 400);
  try {
    const image = await fetchCover(await resolveCloudContext(req), id);
    return new Response(image.body, {
      headers: {
        "content-type": image.contentType,
        // A task's cover never changes; "private" keeps it out of shared caches (it is per user).
        "cache-control": "private, max-age=86400, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    // Visible in the deployment's function logs; the URL is never logged (it is signed).
    console.warn("[cover] task %s: %s", id, error instanceof Error ? error.message : error);
    return errorResponse(error);
  }
}
