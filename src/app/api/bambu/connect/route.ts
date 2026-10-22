import { z } from "zod";
import { getBridgeService } from "@/server/bridge-service";
import { handle } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("source", [
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
  return handle(req, schema, async (body) => {
    const service = getBridgeService();
    await service.init();
    if (body.source === "account")
      await service.connectAccountPrinter(body.serial, body.mode, body.host);
    else await service.connectLanManual(body.host, body.serial, body.accessCode, body.name);
    return service.status();
  });
}
