import type { BridgeServerMessage } from "@/printer/protocol/bridge-protocol";
import { getBridgeService } from "@/server/bridge-service";
import { isHosted } from "@/server/deployment";
import { getHostedService } from "@/server/hosted-service";
import { rejectForeignRequest } from "@/server/http";
import type { PrinterLink } from "@/server/printer-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vercel's limit for one invocation (Hobby and Pro default). Hosted streams end before it. */
export const maxDuration = 300;

const KEEPALIVE_MS = 15_000;
/** Hosted: close and let the browser reconnect before the platform kills the function. */
const HOSTED_STREAM_MS = 280_000;
/** Hosted without a session: close soon so a display picks up a sign-in made in another tab. */
const HOSTED_IDLE_STREAM_MS = 15_000;

/** Server-Sent Events stream of bridge messages (hello, printer_link, snapshot, report). */
export async function GET(req: Request) {
  const rejected = rejectForeignRequest(req);
  if (rejected) return rejected;
  const hosted = isHosted();
  const resume = new URL(req.url).searchParams.get("resume") === "1";

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (msg: BridgeServerMessage) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      let unsubscribe = () => {};
      let link: PrinterLink | null = null;
      let endTimer: ReturnType<typeof setTimeout> | null = null;
      if (hosted) {
        link = getHostedService().openStream(req, send, { resume });
        endTimer = setTimeout(close, link ? HOSTED_STREAM_MS : HOSTED_IDLE_STREAM_MS);
      } else {
        const service = getBridgeService();
        await service.init();
        unsubscribe = service.link.subscribe(send);
      }
      const keepalive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, KEEPALIVE_MS);
      cleanup = () => {
        clearInterval(keepalive);
        if (endTimer) clearTimeout(endTimer);
        unsubscribe();
        link?.stop(null);
      };
      req.signal.addEventListener("abort", close);
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
