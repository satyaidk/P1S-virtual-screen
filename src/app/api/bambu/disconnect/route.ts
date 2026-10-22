import { getBridgeService } from "@/server/bridge-service";
import { handle } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(req, null, async () => {
    const service = getBridgeService();
    await service.init();
    await service.disconnectPrinter();
    return service.status();
  });
}
