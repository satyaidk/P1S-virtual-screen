import { afterEach, describe, expect, it } from "vitest";
import pushall from "../fixtures/p1s-pushall.json";
import { backoffDelay, SOCKET_OPEN, type SocketLike } from "@/printer/connection-manager";
import { LanPrinterProvider } from "@/printer/providers/LanPrinterProvider";
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

let provider: LanPrinterProvider | null = null;

function setup() {
  const clock = new ManualClock();
  const sockets: FakeSocket[] = [];
  provider = new LanPrinterProvider({
    bridgeUrl: "ws://bridge.local/v1/stream",
    clock,
    commandTimeoutMs: 2000,
    socketFactory: (url) => {
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

describe("LanPrinterProvider (fake bridge)", () => {
  it("connects via the bridge, requests a full status and merges reports", async () => {
    const { sockets, provider } = setup();
    await provider.connect();
    expect(provider.getState().connection.status).toBe("connecting");
    const s = sockets[0]!;
    s.open();
    s.receive({
      type: "hello",
      protocol: 1,
      printer: { model: "P1S", name: "Shop P1S", serial: "****1234" },
    });
    s.receive({ type: "printer_link", status: "connected" });
    expect(provider.getState().connection.status).toBe("connected");
    expect(s.sent[0]).toMatchObject({ type: "command", command: { type: "request_full_status" } });

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

  it("ignores invalid bridge messages", async () => {
    const { sockets, provider } = setup();
    const events: string[] = [];
    provider.onEvent((e) => events.push(e.message));
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
