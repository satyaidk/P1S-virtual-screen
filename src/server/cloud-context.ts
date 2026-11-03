import "server-only";
import { getBridgeService } from "./bridge-service";
import { isHosted } from "./deployment";
import { getHostedService } from "./hosted-service";
import type { CloudContext } from "./print-history";

/** Resolve the Bambu Cloud token + printer for this request, in either deployment mode. */
export async function resolveCloudContext(req: Request): Promise<CloudContext> {
  if (isHosted()) return getHostedService().cloudContext(req);
  const service = getBridgeService();
  await service.init();
  return service.cloudContext();
}
