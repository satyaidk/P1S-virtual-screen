import { z } from "zod";
import { getBridgeService } from "@/server/bridge-service";
import { handle } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  region: z.enum(["global", "china"]),
  account: z.string().trim().email().max(200),
});

/** Passwordless sign-in: Bambu emails a one-time code. */
export async function POST(req: Request) {
  return handle(req, schema, async ({ region, account }) => {
    const service = getBridgeService();
    await service.init();
    return service.requestEmailCode(region, account);
  });
}
