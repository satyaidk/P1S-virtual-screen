import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedHosts, rejectForeignRequest } from "@/server/http";

const req = (host: string, origin?: string) =>
  new Request(`http://${host}/api/bridge/command`, {
    method: "POST",
    headers: { host, ...(origin ? { origin } : {}) },
  });

const TS = "home-pc.tail1234.ts.net";

describe("rejectForeignRequest (local mode)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts localhost and rejects other hosts by default", () => {
    expect(rejectForeignRequest(req("localhost:3000"))).toBeNull();
    expect(rejectForeignRequest(req(`${TS}`))?.status).toBe(403);
    expect(rejectForeignRequest(req("192.168.1.20:3000"))?.status).toBe(403);
  });

  it("accepts exactly the names in P1S_ALLOWED_HOSTS", async () => {
    vi.stubEnv("P1S_ALLOWED_HOSTS", ` ${TS.toUpperCase()} , 100.101.102.103:3000 `);
    expect(rejectForeignRequest(req(TS))).toBeNull();
    expect(rejectForeignRequest(req("100.101.102.103:3000"))).toBeNull();
    // Not a suffix match: other tailnet machines and LAN devices stay blocked.
    expect(rejectForeignRequest(req("evil.tail1234.ts.net"))?.status).toBe(403);
    const blocked = rejectForeignRequest(req("192.168.1.20:3000"));
    expect(((await blocked?.json()) as { error: string }).error).toContain("P1S_ALLOWED_HOSTS");
  });

  it("allows a proxy that forwards to localhost only for allowed origins", () => {
    vi.stubEnv("P1S_ALLOWED_HOSTS", TS);
    expect(rejectForeignRequest(req("localhost:3000", `https://${TS}`))).toBeNull();
    expect(rejectForeignRequest(req("localhost:3000", "https://evil.example"))?.status).toBe(403);
  });

  it("rejects cross-origin and malformed origins", () => {
    expect(rejectForeignRequest(req("localhost:3000", "https://evil.example"))?.status).toBe(403);
    expect(rejectForeignRequest(req("localhost:3000", "null"))?.status).toBe(403);
    expect(rejectForeignRequest(req("localhost:3000", "http://localhost:3000"))).toBeNull();
  });

  it("parses the allow-list", () => {
    expect([...allowedHosts("A.example:443, ,b.example")]).toEqual(["a.example", "b.example"]);
    expect(allowedHosts(undefined).size).toBe(0);
  });
});
