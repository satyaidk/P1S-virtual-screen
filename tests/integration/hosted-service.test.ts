import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BridgeServerMessage } from "@/printer/protocol/bridge-protocol";
import { HostedService } from "@/server/hosted-service";
import { handleHosted } from "@/server/http";
import type { MqttClientLike, MqttConnect } from "@/server/printer-link";
import { fakeFetch, jsonResponse } from "../support/fake-fetch";

const SECRET = "s".repeat(48);
const SERIAL = "01P00C662003044";
const token = `h.${Buffer.from(JSON.stringify({ username: "u_9" })).toString("base64url")}.s`;

let connects: { url: string; options: Record<string, unknown>; published: string[] }[] = [];
const fakeConnect: MqttConnect = (url, options) => {
  const entry = { url, options, published: [] as string[] };
  connects.push(entry);
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  const client: MqttClientLike = {
    on: (event: string, cb: (...a: unknown[]) => void) => {
      (handlers[event] ??= []).push(cb);
      if (event === "connect") queueMicrotask(() => cb());
      return client;
    },
    subscribe: () => client,
    publish: (_topic: string, payload: string) => {
      entry.published.push(payload);
      return client;
    },
    end: () => client,
  } as unknown as MqttClientLike;
  return client;
};

const routes = {
  "POST /sendemail/code": () => jsonResponse({}),
  "POST /user/login": () => jsonResponse({ accessToken: token, expiresIn: 7776000 }),
  "GET /api/user/bind": () =>
    jsonResponse({
      devices: [
        {
          dev_id: SERIAL,
          name: "Jashan P1S",
          online: true,
          dev_product_name: "P1S",
          dev_access_code: "abcd1234",
        },
      ],
    }),
};

function service(secret: string | null = SECRET) {
  const f = fakeFetch(routes);
  return new HostedService({
    fetchImpl: f.fetch,
    connect: fakeConnect,
    secret: () => secret ?? undefined,
    printer: () => ({ serial: SERIAL, name: "Bambu Lab P1S", model: "P1S", host: null }),
  });
}

/** Simple cookie jar: what a browser would send back. */
class Jar {
  cookies = new Map<string, string>();
  store(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split("; ");
      const [name, value] = [
        pair!.slice(0, pair!.indexOf("=")),
        pair!.slice(pair!.indexOf("=") + 1),
      ];
      if (attrs.includes("Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  request(body?: unknown, origin?: string): Request {
    const headers: Record<string, string> = { host: "virtualscreen.vercel.app" };
    if (this.cookies.size)
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (origin) headers.origin = origin;
    return new Request("https://virtualscreen.vercel.app/api/x", {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

beforeEach(() => {
  process.env.P1S_HOSTED = "1";
});

afterEach(() => {
  connects = [];
  delete process.env.P1S_HOSTED;
});

describe("HostedService (Vercel, Bambu Cloud via encrypted cookie)", () => {
  it("signs in with an emailed code, auto-selects the built-in printer and streams it read-only", async () => {
    const svc = service();
    const jar = new Jar();

    jar.store(
      await handleHosted(jar.request({}), null, () =>
        svc.requestEmailCode("global", "jashan@example.com"),
      ),
    );
    expect(jar.cookies.has("p1s_login")).toBe(true);
    expect((svc.status(jar.request()).body as { pendingLogin: unknown }).pendingLogin).toEqual({
      kind: "verifyCode",
      account: "ja••••@example.com",
    });

    const verifyReq = jar.request({ code: "123456" });
    jar.store(await handleHosted(verifyReq, null, () => svc.submitCode(verifyReq, "123456")));
    expect(jar.cookies.has("p1s_session")).toBe(true);
    expect(jar.cookies.has("p1s_login")).toBe(false);
    expect([...jar.cookies.values()].join()).not.toContain(token);

    const status = svc.status(jar.request()).body as Record<string, unknown>;
    expect(status).toMatchObject({
      hosted: true,
      setupError: null,
      cloud: { signedIn: true, account: "ja••••@example.com", region: "global" },
      printer: { mode: "cloud", name: "Jashan P1S", maskedSerial: "•••••••••••3044", host: null },
    });

    const messages: BridgeServerMessage[] = [];
    const link = svc.openStream(jar.request(), (m) => messages.push(m), { resume: false });
    expect(link).not.toBeNull();
    expect(connects[0]).toMatchObject({
      url: "mqtts://us.mqtt.bambulab.com:8883",
      options: { username: "u_9", password: token, rejectUnauthorized: true },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(connects[0]!.published.some((p) => p.includes("pushall"))).toBe(true);
    expect(messages[0]).toMatchObject({
      type: "hello",
      mode: "cloud",
      commands: ["request_full_status"],
    });
    link!.stop(null);

    // A reconnecting display does not ask the printer for a full status again.
    const again = svc.openStream(jar.request(), () => {}, { resume: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(connects[1]!.published.some((p) => p.includes("pushall"))).toBe(false);
    again!.stop(null);
  });

  it("refuses LAN/access-code mode on a hosted site and lists printers without access codes", async () => {
    const svc = service();
    const jar = new Jar();
    jar.store(
      await handleHosted(jar.request({}), null, () =>
        svc.loginWithPassword("global", "me@example.com", "pw"),
      ),
    );
    await expect(svc.connectAccountPrinter(jar.request(), SERIAL, "lan")).rejects.toThrow(
      /only works when this app runs/,
    );
    const devices = (await svc.listDevices(jar.request())).body as {
      devices: { hasAccessCode: boolean }[];
    };
    expect(devices.devices[0]?.hasAccessCode).toBe(false);
    expect(JSON.stringify(devices)).not.toContain("abcd1234");
  });

  it("explains a missing session secret instead of failing silently", async () => {
    const svc = service(null);
    const jar = new Jar();
    expect((svc.status(jar.request()).body as { setupError: string }).setupError).toMatch(
      /P1S_SESSION_SECRET/,
    );
    const res = await handleHosted(jar.request({}), null, () =>
      svc.loginWithPassword("global", "a@b.c", "pw"),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/Environment Variables/);
    const messages: BridgeServerMessage[] = [];
    expect(svc.openStream(jar.request(), (m) => messages.push(m), { resume: false })).toBeNull();
    expect(messages[1]).toMatchObject({ type: "printer_link", status: "disconnected" });
  });

  it("tells a signed-out display to sign in, and signing out clears the cookies", async () => {
    const svc = service();
    const jar = new Jar();
    const messages: BridgeServerMessage[] = [];
    expect(svc.openStream(jar.request(), (m) => messages.push(m), { resume: false })).toBeNull();
    expect(messages[1]).toMatchObject({
      error: expect.stringMatching(/sign in with your Bambu account/),
    });

    jar.store(
      await handleHosted(jar.request({}), null, () =>
        svc.loginWithPassword("global", "me@example.com", "pw"),
      ),
    );
    expect(jar.cookies.has("p1s_session")).toBe(true);
    jar.store(await handleHosted(jar.request({}), null, () => svc.logout()));
    expect(jar.cookies.size).toBe(0);
  });

  it("still blocks requests from other websites", async () => {
    const svc = service();
    const jar = new Jar();
    const res = await handleHosted(jar.request({}, "https://evil.example"), null, () =>
      svc.logout(),
    );
    expect(res.status).toBe(403);
  });
});
