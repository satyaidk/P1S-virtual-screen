import type { BridgeServerMessage } from "@/printer/protocol/bridge-protocol";
import { getBridgeService } from "@/server/bridge-service";
import { rejectForeignRequest } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;

/** Server-Sent Events stream of bridge messages (hello, printer_link, snapshot, report). */
export async function GET(req: Request) {
  const rejected = rejectForeignRequest(req);
  if (rejected) return rejected;
  const service = getBridgeService();
  await service.init();

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (msg: BridgeServerMessage) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
      const unsubscribe = service.link.subscribe(send);
      const keepalive = setInterval(
        () => controller.enqueue(encoder.encode(": keepalive\n\n")),
        KEEPALIVE_MS,
      );
      cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
