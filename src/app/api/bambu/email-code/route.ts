import { z } from "zod";
import { getBridgeService } from "@/server/bridge-service";
import { isHosted } from "@/server/deployment";
import { getHostedService } from "@/server/hosted-service";
import { handle, handleHosted } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  region: z.enum(["global", "china"]),
  account: z.string().trim().email().max(200),
});

/** Passwordless sign-in: Bambu emails a one-time code. */
export async function POST(req: Request) {
  if (isHosted()) {
    return handleHosted(req, schema, ({ region, account }) =>
      getHostedService().requestEmailCode(region, account),
    );
  }
  return handle(req, schema, async ({ region, account }) => {
    const service = getBridgeService();
    await service.init();
    return service.requestEmailCode(region, account);
  });
}
