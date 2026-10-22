import { z } from "zod";
import { getBridgeService } from "@/server/bridge-service";
import { handle } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "Enter the code from the email or authenticator"),
});

export async function POST(req: Request) {
  return handle(req, schema, async ({ code }) => {
    const service = getBridgeService();
    await service.init();
    return service.submitCode(code);
  });
}
