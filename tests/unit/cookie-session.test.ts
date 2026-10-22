import { describe, expect, it } from "vitest";
import {
  cloudSessionSchema,
  readCookie,
  readSession,
  seal,
  serializeCookie,
  sessionCookie,
  sessionKey,
  unseal,
  type CookieSession,
} from "@/server/cookie-session";

const key = sessionKey("x".repeat(40))!;
const session: CookieSession = {
  v: 1,
  region: "global",
  account: "me@example.com",
  token: "secret-token",
  mqttUsername: "u_1",
  expiresAt: Date.now() + 3600_000,
  printer: { serial: "01P00C662003044", name: "P1S" },
};

function requestWith(setCookie: string): Request {
  return new Request("https://example.test/", { headers: { cookie: setCookie.split(";")[0]! } });
}

describe("cookie session", () => {
  it("requires a long enough secret", () => {
    expect(sessionKey(undefined)).toBeNull();
    expect(sessionKey("short")).toBeNull();
    expect(sessionKey("y".repeat(32))).toBeInstanceOf(Buffer);
  });

  it("round-trips and hides the token", () => {
    const sealed = seal(session, key);
    expect(sealed).not.toContain("secret-token");
    expect(Buffer.from(sealed, "base64url").toString("utf8")).not.toContain("secret-token");
    expect(unseal(sealed, key, cloudSessionSchema)).toEqual(session);
  });

  it("rejects tampering, other keys and garbage", () => {
    const sealed = seal(session, key);
    const flipped = Buffer.from(sealed, "base64url");
    flipped[flipped.length - 1]! ^= 1;
    expect(unseal(flipped.toString("base64url"), key, cloudSessionSchema)).toBeNull();
    expect(unseal(sealed, sessionKey("z".repeat(40))!, cloudSessionSchema)).toBeNull();
    expect(unseal("nonsense", key, cloudSessionSchema)).toBeNull();
  });

  it("sets safe cookie attributes and reads them back", () => {
    const header = sessionCookie(session, key);
    expect(header).toMatch(
      /^p1s_session=[\w-]+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Strict$/,
    );
    expect(readSession(requestWith(header), key)?.account).toBe("me@example.com");
    expect(
      readCookie(new Request("https://x.test/", { headers: { cookie: "a=1; b=2" } }), "b"),
    ).toBe("2");
    expect(serializeCookie("a", "", 0)).toContain("Max-Age=0");
  });

  it("treats an expired session as signed out", () => {
    const header = sessionCookie({ ...session, expiresAt: Date.now() - 1 }, key);
    expect(readSession(requestWith(header), key)).toBeNull();
  });
});
