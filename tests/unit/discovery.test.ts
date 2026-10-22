import { describe, expect, it } from "vitest";
import { parseSsdpMessage, PrinterDiscovery } from "@/server/discovery";
import { bambuNotify, fakeUdpFactory } from "../support/fake-udp";

const SERIAL = "01P00C662003044";

describe("parseSsdpMessage", () => {
  it("reads a Bambu printer announcement", () => {
    expect(parseSsdpMessage(bambuNotify(SERIAL, "192.168.1.64"), 5)).toEqual({
      serial: SERIAL,
      host: "192.168.1.64",
      model: "C12",
      name: "My P1S",
      connectMode: "cloud",
      signalDbm: -48,
      lastSeen: 5,
    });
  });

  it("ignores other SSDP devices and malformed locations", () => {
    const tv =
      "NOTIFY * HTTP/1.1\r\nLocation: http://192.168.1.9:8008/desc.xml\r\nNT: upnp:rootdevice\r\nUSN: uuid:x\r\n\r\n";
    expect(parseSsdpMessage(tv, 0)).toBeNull();
    expect(parseSsdpMessage(bambuNotify(SERIAL, "not-an-ip"), 0)).toBeNull();
    expect(parseSsdpMessage("garbage", 0)).toBeNull();
  });
});

describe("PrinterDiscovery", () => {
  it("listens on both Bambu discovery ports and probes once", () => {
    const { factory, sockets } = fakeUdpFactory();
    const d = new PrinterDiscovery({ socketFactory: factory, log: () => {} });
    d.start();
    expect(sockets.map((s) => s.port)).toEqual([1990, 2021]);
    expect(sockets[0]!.memberships).toEqual(["239.255.255.250"]);
    expect(sockets[0]!.sent.map((m) => m.port)).toEqual([1990, 2021]);
    expect(sockets[0]!.sent[0]!.msg).toContain("ST: urn:bambulab-com:device:3dprinter:1");
    d.stop();
    expect(sockets.every((s) => s.closed)).toBe(true);
  });

  it("resolves waitFor when the printer announces itself", async () => {
    const { factory, sockets } = fakeUdpFactory();
    const d = new PrinterDiscovery({ socketFactory: factory, log: () => {} });
    const pending = d.waitFor(SERIAL.toLowerCase(), 5000);
    sockets[1]!.receive(bambuNotify("01P00OTHER000001", "192.168.1.70"));
    sockets[1]!.receive(bambuNotify(SERIAL, "192.168.1.64"));
    expect((await pending)?.host).toBe("192.168.1.64");
    expect(d.get(SERIAL)?.name).toBe("My P1S");
    expect(d.all()).toHaveLength(2);
    d.stop();
  });

  it("returns null when the printer is not on the network", async () => {
    const { factory } = fakeUdpFactory();
    const d = new PrinterDiscovery({ socketFactory: factory, log: () => {} });
    expect(await d.waitFor(SERIAL, 20)).toBeNull();
    d.stop();
  });

  it("reports IP changes and port problems", async () => {
    const { factory, sockets } = fakeUdpFactory();
    const d = new PrinterDiscovery({ socketFactory: factory, log: () => {} });
    const seen: string[] = [];
    d.onFound((p) => seen.push(p.host));
    d.start();
    sockets[0]!.receive(bambuNotify(SERIAL, "192.168.1.64"));
    sockets[0]!.receive(bambuNotify(SERIAL, "192.168.1.64"));
    sockets[0]!.receive(bambuNotify(SERIAL, "192.168.1.80"));
    expect(seen).toEqual(["192.168.1.64", "192.168.1.80"]);
    d.stop();

    const broken = fakeUdpFactory({ failBind: new Error("EACCES") });
    const d2 = new PrinterDiscovery({ socketFactory: broken.factory, log: () => {} });
    d2.start();
    await Promise.resolve();
    expect(d2.problems).toEqual(["UDP 1990: EACCES", "UDP 2021: EACCES"]);
    d2.stop();
  });
});
