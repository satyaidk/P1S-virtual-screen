import "server-only";

/**
 * "Hosted" = running on a serverless platform (Vercel) instead of a computer on the printer's
 * network. There the server cannot reach the LAN, keep a process alive or write files, so it uses
 * Bambu Cloud with a per-browser encrypted cookie session (see hosted-service.ts).
 */
export function isHosted(): boolean {
  return process.env.VERCEL === "1" || process.env.P1S_HOSTED === "1";
}
