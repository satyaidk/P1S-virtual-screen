import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeService } from "@/server/bridge-service";
import { PrinterDiscovery } from "@/server/discovery";
import type { MqttClientLike, MqttConnect } from "@/server/printer-link";
import { fakeFetch, jsonResponse } from "../support/fake-fetch";
import { bambuNotify, fakeUdpFactory, type FakeUdpSocket } from "../support/fake-udp";

const DEVICE = {
  dev_id: "01P00C662003044",
  name: "Workshop P1S",
  online: true,
  print_status: "RUNNING",
  dev_model_name: "C12",
  dev_product_name: "P1S",
  dev_access_code: "a1b2c3d4",
};

const token = `h.${Buffer.from(JSON.stringify({ username: "u_1234" })).toString("base64url")}.s`;

let dir: string;
let connects: { url: string; options: Record<string, unknown> }[];

const fakeConnect: MqttConnect = (url, options) => {
  connects.push({ url, options });
  const client: MqttClientLike = {
    on: () => client,
    subscribe: () => client,
    publish: () => client,
    end: () => client,
  };
  return client;
};

const MY_SERIAL = "01P00C662003044";

function service(routes: Parameters<typeof fakeFetch>[0], printer: { host?: string | null } = {}) {
  const f = fakeFetch(routes);
  const udp = fakeUdpFactory();
  const discovery = new PrinterDiscovery({ socketFactory: udp.factory, log: () => {} });
  const svc = new BridgeService({
    connect: fakeConnect,
    fetchImpl: f.fetch,
    discovery,
    discoveryTimeoutMs: 50,
    printer: () => ({
      serial: MY_SERIAL,
      name: "Bambu Lab P1S",
      model: "P1S",
      host: printer.host ?? null,
    }),
  });
  const announce = (host: string) =>
    (udp.sockets[0] as FakeUdpSocket).receive(bambuNotify(MY_SERIAL, host));
  return { svc, calls: f.calls, discovery, announce };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "p1s-"));
  process.env.P1S_DATA_DIR = dir;
  connects = [];
});

afterEach(async () => {
  delete process.env.P1S_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("BridgeService", () => {
  it("signs in with an emailed code, lists printers and connects over the cloud", async () => {
    const { svc, calls } = service({
      "POST /sendemail/code": () => jsonResponse({}),
      "POST /user/login": () => jsonResponse({ accessToken: token, expiresIn: 3600 }),
      "GET /api/user/bind": () => jsonResponse({ devices: [DEVICE] }),
    });
    await svc.init();
    expect(await svc.requestEmailCode("global", "jashan@example.com")).toEqual({
      step: "verifyCode",
    });
    expect(svc.status().pendingLogin).toEqual({
      kind: "verifyCode",
      account: "ja••••@example.com",
    });
    expect(await svc.submitCode("123456")).toEqual({ step: "done" });
    expect(calls.find((c) => c.url.endsWith("/user/login"))?.body).toEqual({
      account: "jashan@example.com",
      code: "123456",
    });

    const devices = await svc.listDevices();
    expect(devices).toEqual([
      expect.objectContaining({
        serial: DEVICE.dev_id,
        maskedSerial: "•••••••••••3044",
        hasAccessCode: true,
      }),
    ]);
    expect(JSON.stringify(devices)).not.toContain(DEVICE.dev_access_code);

    await svc.connectAccountPrinter(DEVICE.dev_id, "cloud");
    expect(connects[0]).toMatchObject({
      url: "mqtts://us.mqtt.bambulab.com:8883",
      options: { username: "u_1234", password: token, rejectUnauthorized: true },
    });
    expect(svc.status()).toMatchObject({
      cloud: { signedIn: true, account: "ja••••@example.com", region: "global" },
      printer: { mode: "cloud", name: "Workshop P1S", maskedSerial: "•••••••••••3044" },
    });
  });

  it("persists the session privately and reconnects after a restart", async () => {
    const routes = {
      "POST /user/login": () => jsonResponse({ accessToken: token, expiresIn: 3600 }),
      "GET /api/user/bind": () => jsonResponse({ devices: [DEVICE] }),
    };
    const first = service(routes).svc;
    await first.init();
    await first.loginWithPassword("global", "me@example.com", "secret-pw");
    await first.connectAccountPrinter(DEVICE.dev_id, "lan", "192.168.1.50");
    expect(connects.at(-1)).toMatchObject({
      url: "mqtts://192.168.1.50:8883",
      options: {
        username: "bblp",
        password: "a1b2c3d4",
        servername: DEVICE.dev_id,
        rejectUnauthorized: true,
      },
    });

    const file = path.join(dir, "bambu-session.json");
    const saved = await readFile(file, "utf8");
    expect(saved).not.toContain("secret-pw");
    expect((await stat(file)).mode & 0o077).toBe(0);

    connects = [];
    const second = service(routes).svc;
    await second.init();
    expect(connects[0]?.url).toBe("mqtts://192.168.1.50:8883");
  });

  it("supports LAN without an account and validates input", async () => {
    const { svc } = service({});
    await svc.init();
    await expect(
      svc.connectLanManual("not a host!", "01P00C662003044", "a1b2c3d4"),
    ).rejects.toThrow(/Invalid IP/);
    await expect(svc.connectLanManual("192.168.1.9", "x", "a1b2c3d4")).rejects.toThrow(/serial/);
    await svc.connectLanManual("192.168.1.9", "01p00c662003044", "a1b2c3d4");
    expect(connects[0]?.options).toMatchObject({ servername: "01P00C662003044" });
  });

  it("requires sign-in before listing printers and clears an expired session", async () => {
    const { svc } = service({
      "POST /user/login": () => jsonResponse({ accessToken: token }),
      "GET /api/user/bind": () => jsonResponse({ code: 4, error: "Please login." }, 401),
    });
    await svc.init();
    await expect(svc.listDevices()).rejects.toMatchObject({ status: 401 });
    await svc.loginWithPassword("global", "me@example.com", "pw");
    await expect(svc.listDevices()).rejects.toThrow(/expired/);
    expect(svc.status().cloud.signedIn).toBe(false);
  });
});

describe("BridgeService — access code only", () => {
  it("uses the built-in serial and the discovered IP", async () => {
    const { svc, discovery, announce } = service({});
    await svc.init();
    expect(svc.status().myPrinter).toMatchObject({
      maskedSerial: "•••••••••••3044",
      host: null,
      hostSource: null,
    });
    announce("192.168.1.64");
    expect(svc.status().myPrinter).toMatchObject({
      host: "192.168.1.64",
      hostSource: "discovered",
      name: "My P1S",
    });

    await svc.connectWithAccessCode(" 12345678 ");
    expect(connects.at(-1)).toMatchObject({
      url: "mqtts://192.168.1.64:8883",
      options: {
        username: "bblp",
        password: "12345678",
        servername: MY_SERIAL,
        rejectUnauthorized: true,
      },
    });
    expect(svc.status().printer).toMatchObject({
      mode: "lan",
      host: "192.168.1.64",
      maskedSerial: "•••••••••••3044",
    });
    discovery.stop();
  });

  it("waits for the printer to announce itself while connecting", async () => {
    const { svc, discovery, announce } = service({});
    await svc.init();
    const pending = svc.connectWithAccessCode("12345678");
    announce("192.168.1.99");
    await pending;
    expect(connects.at(-1)?.url).toBe("mqtts://192.168.1.99:8883");
    discovery.stop();
  });

  it("explains when the printer is not found, and validates the code", async () => {
    const { svc, discovery } = service({});
    await svc.init();
    await expect(svc.connectWithAccessCode("12")).rejects.toThrow(/8 characters/);
    await expect(svc.connectWithAccessCode("12345678")).rejects.toMatchObject({ status: 404 });
    expect(connects).toHaveLength(0);
    discovery.stop();
  });

  it("accepts a typed or configured IP instead of discovery", async () => {
    const typed = service({});
    await typed.svc.init();
    await typed.svc.connectWithAccessCode("12345678", "10.0.0.5");
    expect(connects.at(-1)?.url).toBe("mqtts://10.0.0.5:8883");
    typed.discovery.stop();

    const configured = service({}, { host: "10.0.0.6" });
    await configured.svc.init();
    expect(configured.svc.status().myPrinter).toMatchObject({
      host: "10.0.0.6",
      hostSource: "configured",
    });
    await configured.svc.connectWithAccessCode("12345678");
    expect(connects.at(-1)?.url).toBe("mqtts://10.0.0.6:8883");
    configured.discovery.stop();
  });

  it("follows the printer to a new IP address after DHCP changes it", async () => {
    const { svc, discovery, announce } = service({});
    await svc.init();
    announce("192.168.1.64");
    await svc.connectWithAccessCode("12345678");
    announce("192.168.1.65");
    await new Promise((r) => setTimeout(r, 10));
    expect(connects.at(-1)?.url).toBe("mqtts://192.168.1.65:8883");
    expect(svc.status().printer?.host).toBe("192.168.1.65");
    discovery.stop();
  });

  it("reconnects after a restart without asking for the code again", async () => {
    const first = service({});
    await first.svc.init();
    first.announce("192.168.1.64");
    await first.svc.connectWithAccessCode("12345678");
    first.discovery.stop();

    connects = [];
    const second = service({});
    await second.svc.init();
    expect(connects[0]).toMatchObject({
      url: "mqtts://192.168.1.64:8883",
      options: { password: "12345678" },
    });
    second.discovery.stop();
  });
});
