export const dynamic = "force-static";

/** Build identity, to check which version a deployment serves: curl <site>/api/version */
export function GET() {
  return Response.json({
    commit: process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "unknown",
    branch: process.env.NEXT_PUBLIC_BUILD_BRANCH || null,
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? null,
  });
}
