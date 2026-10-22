import { z } from "zod";
import { getBridgeService } from "@/server/bridge-service";
import { isHosted } from "@/server/deployment";
import { getHostedService, HOSTED_LAN_UNAVAILABLE } from "@/server/hosted-service";
import { CloudError } from "@/server/bambu-cloud";
import { handle, handleHosted } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("source", [
  /** Default flow: built-in serial + discovered IP; only the access code is typed. */
  z.object({
    source: z.literal("access-code"),
    accessCode: z.string().trim().min(1).max(32),
    host: z.string().trim().max(253).optional(),
  }),
  z.object({
    source: z.literal("account"),
    serial: z.string().min(8).max(32),
    mode: z.enum(["cloud", "lan"]),
    host: z.string().trim().max(253).optional(),
  }),
  z.object({
    source: z.literal("manual"),
    host: z.string().trim().min(1).max(253),
    serial: z.string().trim().min(8).max(32),
    accessCode: z.string().trim().min(6).max(16),
    name: z.string().trim().max(60).optional(),
  }),
]);

export async function POST(req: Request) {
  if (isHosted()) {
    return handleHosted(req, schema, (body) => {
      if (body.source !== "account") throw new CloudError(HOSTED_LAN_UNAVAILABLE, 400);
      return getHostedService().connectAccountPrinter(req, body.serial, body.mode);
    });
  }
  return handle(req, schema, async (body) => {
    const service = getBridgeService();
    await service.init();
    switch (body.source) {
      case "access-code":
        await service.connectWithAccessCode(body.accessCode, body.host || undefined);
        break;
      case "account":
        await service.connectAccountPrinter(body.serial, body.mode, body.host);
        break;
      case "manual":
        await service.connectLanManual(body.host, body.serial, body.accessCode, body.name);
        break;
    }
    return service.status();
  });
}
