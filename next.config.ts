import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * Which commit this build came from. Vercel sets VERCEL_GIT_COMMIT_SHA, GitHub Actions sets
 * GITHUB_SHA; locally we ask git. Shown on the display (More → Printer info) and at /api/version
 * so it is always obvious which version a deployment is running.
 */
function buildCommit(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit(),
    NEXT_PUBLIC_BUILD_BRANCH: process.env.VERCEL_GIT_COMMIT_REF ?? "",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
