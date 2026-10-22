import type { PrinterCommand } from "@/printer/commands";
import { bridgeCommandMessageSchema } from "@/printer/protocol/bridge-protocol";
import { getBridgeService } from "@/server/bridge-service";
import { isHosted } from "@/server/deployment";
import { handle } from "@/server/http";
import { CLOUD_READ_ONLY_REASON } from "@/server/printer-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Executes one command and answers with a `command_result` bridge message. */
export async function POST(req: Request) {
  return handle(req, bridgeCommandMessageSchema, async ({ requestId, command }) => {
    if (isHosted()) {
      // Hosted = Bambu Cloud only, which is read-only. Status refreshes are already streaming.
      const ok = command.type === "request_full_status";
      return { type: "command_result", requestId, ok, message: ok ? null : CLOUD_READ_ONLY_REASON };
    }
    const service = getBridgeService();
    await service.init();
    const result = await service.link.command(command as unknown as PrinterCommand);
    return { type: "command_result", requestId, ok: result.ok, message: result.message };
  });
}
