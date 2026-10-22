import { afterEach, describe, expect, it } from "vitest";
import pushall from "../fixtures/p1s-pushall.json";
import { backoffDelay, SOCKET_OPEN, type SocketLike } from "@/printer/connection-manager";
import { BridgePrinterProvider } from "@/printer/providers/BridgePrinterProvider";
import { ManualClock } from "@/printer/simulation/clock";
import { advance, flush } from "./helpers";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  onopen: SocketLike["onopen"] = null;
  onclose: SocketLike["onclose"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = SOCKET_OPEN;
    this.onopen?.({});
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(reason = "gone") {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason });
  }
}

let provider: BridgePrinterProvider | null = null;

function setup() {
  const clock = new ManualClock();
  const sockets: FakeSocket[] = [];
  provider = new BridgePrinterProvider({
    bridgeUrl: "/api/bridge",
    clock,
    commandTimeoutMs: 2000,
    socketFactory: (url: string) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
  });
  return { clock, sockets, provider };
}

afterEach(() => {
  provider?.dispose();
  provider = null;
});

const HELLO_LAN = {
  type: "hello",
  protocol: 2,
  printer: { model: "P1S", name: "Shop P1S", serial: "••••1234" },
  mode: "lan",
  commands: ["pause", "resume", "stop", "set_speed", "request_full_status"],
  readOnlyReason: null,
};

const HELLO_CLOUD = {
  ...HELLO_LAN,
  mode: "cloud",
  commands: ["request_full_status"],
  readOnlyReason: "Read-only over Bambu Cloud",
};

describe("BridgePrinterProvider (fake bridge)", () => {
  it("connects via the bridge and merges partial reports", async () => {
    const { sockets, provider } = setup();
    await provider.connect();
    expect(provider.getState().connection.status).toBe("connecting");
    const s = sockets[0]!;
    s.open();
    s.receive(HELLO_LAN);
    s.receive({ type: "printer_link", status: "connected" });
    expect(provider.getState().connection.status).toBe("connected");
    expect(provider.getState().info.connectionMode).toBe("lan");
    expect(provider.capabilities.commands.has("pause")).toBe(true);

    s.receive({ type: "report", payload: pushall });
    s.receive({ type: "report", payload: { print: { nozzle_temper: 150 } } });
    const st = provider.getState();
    expect(st.info.name).toBe("Shop P1S");
    expect(st.nozzle).toEqual({ current: 150, target: 25 });
    expect(st.ams.units?.[0]?.trays).toHaveLength(4);
    expect(Object.isFrozen(st)).toBe(true);
  });

  it("resolves commands from command_result and times out otherwise", async () => {
    const { clock, sockets, provider } = setup();
    await provider.connect();
    const s = sockets[0]!;
    s.open();
    s.receive(HELLO_LAN);
    s.receive({ type: "printer_link", status: "connected" });

    const p = provider.sendCommand({ type: "pause" });
    const sent = s.sent.at(-1) as { requestId: string };
    s.receive({ type: "command_result", requestId: sent.requestId, ok: true });
    expect(await p).toEqual({ ok: true, message: undefined });

    const t = provider.sendCommand({ type: "resume" });
    await advance(clock, 2100);
    expect(await t).toEqual({ ok: false, message: "No response from bridge" });
  });

  it("rejects simulation-only commands", async () => {
    const { provider } = setup();
    expect(await provider.sendCommand({ type: "start_sample_job" })).toMatchObject({ ok: false });
  });

  it("is read-only over the cloud and explains why", async () => {
    const { sockets, provider } = setup();
    await provider.connect();
    sockets[0]!.open();
    sockets[0]!.receive(HELLO_CLOUD);
    expect(provider.getState().info.connectionMode).toBe("cloud");
    expect(provider.capabilities.unsupportedReason).toBe("Read-only over Bambu Cloud");
    expect(await provider.sendCommand({ type: "pause" })).toEqual({
      ok: false,
      message: "Read-only over Bambu Cloud",
    });
    expect(sockets[0]!.sent).toHaveLength(0);
  });

  it("adopts the server snapshot so a late client sees the full state", async () => {
    const { sockets, provider } = setup();
    await provider.connect();
    sockets[0]!.open();
    sockets[0]!.receive(HELLO_LAN);
    sockets[0]!.receive({ type: "printer_link", status: "connected" });
    const { createUnknownState } = await import("@/printer/state");
    const snap = createUnknownState("live", "Shop P1S");
    sockets[0]!.receive({
      type: "snapshot",
      state: {
        ...snap,
        status: "printing",
        nozzle: { current: 219, target: 220 },
        connection: { ...snap.connection, status: "disconnected", lastTelemetryAt: 5 },
      },
    });
    const st = provider.getState();
    expect(st.status).toBe("printing");
    expect(st.nozzle.current).toBe(219);
    expect(st.connection.status).toBe("connected"); // client view of the link is kept
    expect(st.connection.lastTelemetryAt).toBe(5);
    expect(st.info.connectionMode).toBe("lan");
  });

  it("ignores invalid bridge messages", async () => {
    const { sockets, provider } = setup();
    const events: string[] = [];
    provider.onEvent((e: { message: string }) => events.push(e.message));
    await provider.connect();
    sockets[0]!.open();
    sockets[0]!.receive({ type: "mystery" });
    sockets[0]!.onmessage?.({ data: "{oops" });
    expect(events).toContain("Unrecognized bridge message");
    expect(events).toContain("Bridge sent invalid JSON");
  });

  it("reconnects with backoff and fails in-flight commands on drop", async () => {
    const { clock, sockets, provider } = setup();
    await provider.connect();
    sockets[0]!.open();
    sockets[0]!.receive(HELLO_LAN);
    sockets[0]!.receive({ type: "printer_link", status: "connected" });
    const inFlight = provider.sendCommand({ type: "pause" });
    sockets[0]!.drop();
    await flush();
    expect(await inFlight).toEqual({ ok: false, message: "Bridge connection lost" });
    expect(provider.getState().connection.status).toBe("disconnected");

    await advance(clock, 999);
    expect(sockets).toHaveLength(1);
    await advance(clock, 2);
    expect(sockets).toHaveLength(2);
    sockets[1]!.drop();
    await advance(clock, 1999);
    expect(sockets).toHaveLength(2);
    await advance(clock, 2);
    expect(sockets).toHaveLength(3);
  });

  it("caps backoff", () => {
    expect([0, 1, 2, 3, 10].map((n) => backoffDelay(n))).toEqual([1000, 2000, 4000, 8000, 30000]);
  });
});
