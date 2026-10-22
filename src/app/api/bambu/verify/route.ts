import { z } from "zod";
import { getBridgeService } from "@/server/bridge-service";
import { isHosted } from "@/server/deployment";
import { getHostedService } from "@/server/hosted-service";
import { handle, handleHosted } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "Enter the code from the email or authenticator"),
});

export async function POST(req: Request) {
  if (isHosted()) {
    return handleHosted(req, schema, ({ code }) => getHostedService().submitCode(req, code));
  }
  return handle(req, schema, async ({ code }) => {
    const service = getBridgeService();
    await service.init();
    return service.submitCode(code);
  });
}
