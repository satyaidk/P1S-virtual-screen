import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeService } from "@/server/bridge-service";
import type { MqttClientLike, MqttConnect } from "@/server/printer-link";
import { fakeFetch, jsonResponse } from "../support/fake-fetch";

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

function service(routes: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(routes);
  return { svc: new BridgeService(fakeConnect, f.fetch), calls: f.calls };
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
