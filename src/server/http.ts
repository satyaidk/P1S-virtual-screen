import "server-only";
import { z } from "zod";
import { CloudError } from "./bambu-cloud";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * These routes control a physical printer and hold account credentials, so by default they only
 * answer requests addressed to this machine, and only from this app's own pages (blocks other
 * websites and DNS-rebinding). Set P1S_ALLOW_LAN_CLIENTS=1 to use the console from another device.
 */
export function rejectForeignRequest(req: Request): Response | null {
  if (process.env.VERCEL) {
    // Serverless functions cannot hold the printer's MQTT connection or store the session, and a
    // public URL must not expose printer control. The live connection is a local-server feature.
    return json(
      {
        error:
          "Live printer connection needs this app running on your own computer (npm run dev). Hosted deployments only support demo mode (/?demo=1).",
      },
      403,
    );
  }
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? url.host;
  const hostname = host.replace(/:\d+$/, "");
  if (process.env.P1S_ALLOW_LAN_CLIENTS !== "1" && !LOCAL_HOSTS.has(hostname)) {
    return json(
      {
        error:
          "This server only accepts requests to localhost (set P1S_ALLOW_LAN_CLIENTS=1 to allow LAN devices)",
      },
      403,
    );
  }
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== host) {
    return json({ error: "Cross-origin request rejected" }, 403);
  }
  return null;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof CloudError)
    return json(
      { error: error.message, code: error.code },
      error.status >= 400 ? error.status : 500,
    );
  if (error instanceof z.ZodError)
    return json({ error: "Invalid request", issues: error.issues.slice(0, 3) }, 400);
  console.error("[p1s-virtual-screen]", error);
  return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
}

/** Parse a JSON body with a zod schema and run the handler, mapping errors to responses. */
export async function handle<T>(
  req: Request,
  schema: z.ZodType<T> | null,
  fn: (body: T) => Promise<unknown>,
): Promise<Response> {
  const rejected = rejectForeignRequest(req);
  if (rejected) return rejected;
  try {
    const body = schema ? schema.parse(await req.json().catch(() => ({}))) : (undefined as T);
    return json((await fn(body)) ?? { ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
