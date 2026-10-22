import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { Aedes } from "aedes";
import mqtt, { type MqttClient } from "mqtt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import pushall from "../fixtures/p1s-pushall.json";
import type { BridgeServerMessage } from "@/printer/protocol/bridge-protocol";
import { PrinterLink, type LinkConfig, type MqttConnect } from "@/server/printer-link";

/**
 * Runs the server-side link against a real MQTT broker (aedes) and a fake P1S that answers like
 * the real firmware: full report on `pushall`, `result` acks echoing `sequence_id`, partial
 * reports afterwards. TLS is the only thing not exercised here.
 */

const SERIAL = "01P00C000000001";
const ACCESS_CODE = "12345678";

let broker: Aedes;
let server: Server;
let port: number;
let printer: MqttClient;
let links: PrinterLink[] = [];

function config(overrides: Partial<LinkConfig> = {}): LinkConfig {
  return {
    mode: "lan",
    serial: SERIAL,
    name: "Test P1S",
    model: "P1S",
    url: `mqtt://127.0.0.1:${port}`,
    username: "bblp",
    password: ACCESS_CODE,
    tls: { rejectUnauthorized: true },
    ...overrides,
  };
}

function newLink() {
  const link = new PrinterLink({
    connect: mqtt.connect as unknown as MqttConnect,
    ackTimeoutMs: 1500,
  });
  links.push(link);
  const messages: BridgeServerMessage[] = [];
  link.subscribe((m) => messages.push(m));
  return { link, messages };
}

beforeAll(async () => {
  broker = await Aedes.createBroker({
    authenticate: (_client, username, password, done) => {
      const ok = username === "bblp" && password?.toString() === ACCESS_CODE;
      done(ok ? null : Object.assign(new Error("Not authorized"), { returnCode: 5 }), ok);
    },
  });
  server = createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;

  printer = mqtt.connect(`mqtt://127.0.0.1:${port}`, { username: "bblp", password: ACCESS_CODE });
  await new Promise<void>((resolve) => printer.on("connect", () => resolve()));
  await printer.subscribeAsync(`device/${SERIAL}/request`);
  printer.on("message", (_topic, buf) => {
    const msg = JSON.parse(buf.toString()) as Record<
      string,
      { command?: string; sequence_id?: string }
    >;
    const report = (payload: unknown) =>
      printer.publish(`device/${SERIAL}/report`, JSON.stringify(payload));
    if (msg.pushing?.command === "pushall") report(pushall);
    if (msg.print?.command === "pause") {
      report({
        print: {
          command: "pause",
          sequence_id: msg.print.sequence_id,
          result: "success",
          reason: "",
        },
      });
      report({ print: { gcode_state: "PAUSE" } });
    }
    if (msg.print?.command === "gcode_line") {
      report({
        print: {
          command: "gcode_line",
          sequence_id: msg.print.sequence_id,
          result: "fail",
          reason: "busy",
        },
      });
    }
  });
});

afterEach(() => {
  for (const l of links) l.stop(null);
  links = [];
});

afterAll(async () => {
  await printer.endAsync();
  await new Promise<void>((resolve) => broker.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("PrinterLink with a real MQTT broker", () => {
  it("connects, requests a full status and streams reports", async () => {
    const { link, messages } = newLink();
    link.start(config());
    await vi.waitFor(() => expect(link.current.status).toBe("connected"));
    await vi.waitFor(() => expect(messages.some((m) => m.type === "report")).toBe(true));
    const hello = messages.find((m) => m.type === "hello" && m.printer);
    expect(hello).toMatchObject({
      mode: "lan",
      printer: { name: "Test P1S", serial: "•••••••••••0001" },
    });
    expect(JSON.stringify(messages)).not.toContain(ACCESS_CODE);
  });

  it("gives late subscribers the accumulated snapshot", async () => {
    const { link } = newLink();
    link.start(config());
    await vi.waitFor(() => expect(link.current.status).toBe("connected"));
    printer.publish(`device/${SERIAL}/report`, JSON.stringify({ print: { nozzle_temper: 201.5 } }));
    const late: BridgeServerMessage[] = [];
    await vi.waitFor(() => {
      late.length = 0;
      link.subscribe((m) => late.push(m))();
      const snap = late.find((m) => m.type === "snapshot");
      expect(snap?.type === "snapshot" && snap.state.nozzle.current).toBe(201.5);
      // Fields from the earlier full report are preserved.
      expect(snap?.type === "snapshot" && snap.state.ams.units?.length).toBe(1);
    });
  });

  it("matches printer acknowledgements by sequence_id", async () => {
    const { link } = newLink();
    link.start(config());
    await vi.waitFor(() => expect(link.current.status).toBe("connected"));
    expect(await link.command({ type: "pause" })).toEqual({ ok: true, message: null });
    expect(await link.command({ type: "set_bed_target", celsius: 60 })).toEqual({
      ok: false,
      message: "busy",
    });
  });

  it("refuses control over the cloud and unconfirmed stops", async () => {
    const { link } = newLink();
    link.start(config({ mode: "cloud" }));
    await vi.waitFor(() => expect(link.current.status).toBe("connected"));
    const res = await link.command({ type: "pause" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Read-only via Bambu Cloud/);
    expect(link.supportedCommands().has("request_full_status")).toBe(true);

    link.start(config());
    await vi.waitFor(() => expect(link.current.status).toBe("connected"));
    expect(await link.command({ type: "stop" } as never)).toEqual({
      ok: false,
      message: "Stop requires confirmation",
    });
  });

  it("explains a wrong access code", async () => {
    const { link } = newLink();
    link.start(config({ password: "wrong" }));
    await vi.waitFor(() => expect(link.current.error).toMatch(/access code/));
    expect(link.current.status).not.toBe("connected");
  });
});
