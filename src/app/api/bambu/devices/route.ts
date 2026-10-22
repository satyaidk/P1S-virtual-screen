import { getBridgeService } from "@/server/bridge-service";
import { isHosted } from "@/server/deployment";
import { getHostedService } from "@/server/hosted-service";
import { handle, handleHosted } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Printers bound to the signed-in account (access codes are never included). */
export async function GET(req: Request) {
  if (isHosted()) return handleHosted(req, null, () => getHostedService().listDevices(req));
  return handle(req, null, async () => {
    const service = getBridgeService();
    await service.init();
    return { devices: await service.listDevices() };
  });
}
