import "server-only";
import { z } from "zod";
import { CloudError } from "./bambu-cloud";
import { MissingSecretError } from "./cookie-session";
import { isHosted } from "./deployment";
import type { HostedResult } from "./hosted-service";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * These routes control a physical printer and hold account credentials.
 * - Local (default): only requests addressed to this machine are answered (blocks other devices
 *   and DNS rebinding). Set P1S_ALLOW_LAN_CLIENTS=1 to use the console from another device.
 * - Hosted (Vercel): public by nature; each visitor only reaches their own encrypted cookie
 *   session (see hosted-service.ts).
 * Both reject cross-origin requests so other websites cannot drive these endpoints.
 */
export function rejectForeignRequest(req: Request): Response | null {
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? url.host;
  if (!isHosted()) {
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
  if (error instanceof MissingSecretError) return json({ error: error.message }, 503);
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

/** Like `handle`, for hosted handlers that also set (encrypted) cookies. */
export async function handleHosted<T>(
  req: Request,
  schema: z.ZodType<T> | null,
  fn: (body: T) => Promise<HostedResult> | HostedResult,
): Promise<Response> {
  const rejected = rejectForeignRequest(req);
  if (rejected) return rejected;
  try {
    const body = schema ? schema.parse(await req.json().catch(() => ({}))) : (undefined as T);
    const result = await fn(body);
    const response = json(result.body ?? { ok: true });
    for (const cookie of result.cookies) response.headers.append("set-cookie", cookie);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
