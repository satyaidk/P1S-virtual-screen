import { getBridgeService } from "@/server/bridge-service";
import { handle } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, null, async () => {
    const service = getBridgeService();
    await service.init();
    return service.status();
  });
}
