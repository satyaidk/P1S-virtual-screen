import { getBridgeService } from "@/server/bridge-service";
import { isHosted } from "@/server/deployment";
import { getHostedService } from "@/server/hosted-service";
import { handle, handleHosted } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (isHosted()) return handleHosted(req, null, () => getHostedService().disconnect(req));
  return handle(req, null, async () => {
    const service = getBridgeService();
    await service.init();
    await service.disconnectPrinter();
    return service.status();
  });
}
