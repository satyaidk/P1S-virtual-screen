import { resolveCloudContext } from "@/server/cloud-context";
import { handle } from "@/server/http";
import { listPublicTasks } from "@/server/print-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent prints of the selected printer (newest first), with same-origin cover URLs. */
export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? "10");
  const limit = Number.isInteger(raw) ? Math.min(20, Math.max(1, raw)) : 10;
  return handle(req, null, async () => ({
    tasks: await listPublicTasks(await resolveCloudContext(req), limit),
  }));
}
