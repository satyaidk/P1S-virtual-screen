import { z } from "zod";
import { getBridgeService } from "@/server/bridge-service";
import { isHosted } from "@/server/deployment";
import { getHostedService } from "@/server/hosted-service";
import { handle, handleHosted } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  region: z.enum(["global", "china"]),
  account: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

/** Password sign-in. The password is forwarded to Bambu once and never stored. */
export async function POST(req: Request) {
  if (isHosted()) {
    return handleHosted(req, schema, ({ region, account, password }) =>
      getHostedService().loginWithPassword(region, account, password),
    );
  }
  return handle(req, schema, async ({ region, account, password }) => {
    const service = getBridgeService();
    await service.init();
    return service.loginWithPassword(region, account, password);
  });
}
