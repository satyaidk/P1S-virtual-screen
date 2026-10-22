import type { PrinterCommand } from "@/printer/commands";
import { bridgeCommandMessageSchema } from "@/printer/protocol/bridge-protocol";
import { getBridgeService } from "@/server/bridge-service";
import { handle } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Executes one command and answers with a `command_result` bridge message. */
export async function POST(req: Request) {
  return handle(req, bridgeCommandMessageSchema, async ({ requestId, command }) => {
    const service = getBridgeService();
    await service.init();
    const result = await service.link.command(command as unknown as PrinterCommand);
    return { type: "command_result", requestId, ok: result.ok, message: result.message };
  });
}
