import "server-only";
import dgram from "node:dgram";

/**
 * Finds Bambu printers on the local network.
 *
 * Bambu printers announce themselves with SSDP-style "NOTIFY" datagrams every few seconds, in both
 * cloud and LAN mode — this is how Bambu Studio finds them. Bambu's port table lists discovery on
 * UDP 1990 and 2021 (multicast 239.255.255.250 / broadcast). A typical announcement:
 *
 *   NOTIFY * HTTP/1.1
 *   Host: 239.255.255.250:1990
 *   Location: 192.168.1.64
 *   NT: urn:bambulab-com:device:3dprinter:1
 *   USN: <serial>
 *   DevModel.bambu.com: C12
 *   DevName.bambu.com: My P1S
 *   DevConnect.bambu.com: cloud
 *   DevBind.bambu.com: occupied
 */

export interface DiscoveredPrinter {
  serial: string;
  host: string;
  model: string | null;
  name: string | null;
  /** "cloud" or "lan" as announced by the printer. */
  connectMode: string | null;
  signalDbm: number | null;
  lastSeen: number;
}

export const SSDP_GROUP = "239.255.255.250";
export const SSDP_PORTS = [1990, 2021] as const;
export const BAMBU_DEVICE_URN = "urn:bambulab-com:device:3dprinter:1";

const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Parse one SSDP datagram. Returns null for anything that is not a Bambu printer announcement. */
export function parseSsdpMessage(text: string, now: number): DiscoveredPrinter | null {
  const headers = new Map<string, string>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
  }
  const nt = headers.get("nt") ?? headers.get("st");
  const serial = headers.get("usn");
  const location = headers.get("location");
  if (nt !== BAMBU_DEVICE_URN || !serial || !location) return null;
  // Location is a bare IP on Bambu printers; tolerate "http://ip:port/..." just in case.
  const host = location.replace(/^[a-z]+:\/\//i, "").replace(/[:/].*$/, "");
  if (!IPV4_RE.test(host)) return null;
  const signal = Number(headers.get("devsignal.bambu.com"));
  return {
    serial: serial.toUpperCase(),
    host,
    model: headers.get("devmodel.bambu.com") ?? null,
    name: headers.get("devname.bambu.com") ?? null,
    connectMode: headers.get("devconnect.bambu.com") ?? null,
    signalDbm: Number.isFinite(signal) && headers.has("devsignal.bambu.com") ? signal : null,
    lastSeen: now,
  };
}

/** Minimal UDP socket surface (lets tests inject a fake). */
export interface UdpSocketLike {
  on(
    event: "message",
    cb: (msg: Buffer, rinfo: { address: string; port: number }) => void,
  ): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  bind(port: number, cb?: () => void): unknown;
  addMembership(group: string): void;
  setBroadcast(flag: boolean): void;
  send(msg: string, port: number, address: string, cb?: (err: Error | null) => void): unknown;
  close(): void;
}

export type UdpSocketFactory = () => UdpSocketLike;

const defaultFactory: UdpSocketFactory = () =>
  dgram.createSocket({ type: "udp4", reuseAddr: true }) as unknown as UdpSocketLike;

export interface DiscoveryOptions {
  socketFactory?: UdpSocketFactory;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * Listens for printer announcements for the lifetime of the server and remembers where each
 * printer was last seen. Also sends an M-SEARCH probe to speed up the first answer.
 */
export class PrinterDiscovery {
  private sockets: UdpSocketLike[] = [];
  private seen = new Map<string, DiscoveredPrinter>();
  private waiters = new Set<{ serial: string; resolve: (p: DiscoveredPrinter | null) => void }>();
  private listeners = new Set<(p: DiscoveredPrinter) => void>();
  private started = false;
  private readonly socketFactory: UdpSocketFactory;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private errors: string[] = [];

  constructor(options: DiscoveryOptions = {}) {
    this.socketFactory = options.socketFactory ?? defaultFactory;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((m) => console.warn(`[discovery] ${m}`));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const port of SSDP_PORTS) {
      let socket: UdpSocketLike;
      try {
        socket = this.socketFactory();
      } catch (e) {
        this.fail(port, e);
        continue;
      }
      socket.on("message", (msg) => this.onMessage(msg));
      socket.on("error", (err) => this.fail(port, err));
      try {
        socket.bind(port, () => {
          try {
            socket.addMembership(SSDP_GROUP);
          } catch {
            /* broadcast-only networks: still fine */
          }
          try {
            socket.setBroadcast(true);
          } catch {
            /* ignore */
          }
          if (port === SSDP_PORTS[0]) this.probe(socket);
        });
      } catch (e) {
        this.fail(port, e);
        continue;
      }
      this.sockets.push(socket);
    }
  }

  stop(): void {
    for (const s of this.sockets) {
      try {
        s.close();
      } catch {
        /* already closed */
      }
    }
    this.sockets = [];
    this.started = false;
    for (const w of this.waiters) w.resolve(null);
    this.waiters.clear();
  }

  /** Send a discovery request; printers answer or simply keep announcing. */
  probe(socket = this.sockets[0]): void {
    if (!socket) return;
    const msg = [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${SSDP_GROUP}:1990`,
      'MAN: "ssdp:discover"',
      "MX: 3",
      `ST: ${BAMBU_DEVICE_URN}`,
      "",
      "",
    ].join("\r\n");
    socket.send(msg, 1990, SSDP_GROUP, () => {});
    socket.send(msg, 2021, "255.255.255.255", () => {});
  }

  get(serial: string): DiscoveredPrinter | null {
    return this.seen.get(serial.toUpperCase()) ?? null;
  }

  all(): DiscoveredPrinter[] {
    return [...this.seen.values()];
  }

  /** Problems binding the discovery ports (e.g. blocked by a firewall). */
  get problems(): readonly string[] {
    return this.errors;
  }

  onFound(listener: (p: DiscoveredPrinter) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolve with the printer as soon as it announces itself, or null after `timeoutMs`. */
  waitFor(serial: string, timeoutMs: number): Promise<DiscoveredPrinter | null> {
    const known = this.get(serial);
    if (known) return Promise.resolve(known);
    this.start();
    this.probe();
    return new Promise((resolve) => {
      const waiter = {
        serial: serial.toUpperCase(),
        resolve: (p: DiscoveredPrinter | null) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve(p);
        },
      };
      const timer = setTimeout(() => waiter.resolve(null), timeoutMs);
      this.waiters.add(waiter);
    });
  }

  private onMessage(buffer: Buffer): void {
    const printer = parseSsdpMessage(buffer.toString("utf8"), this.now());
    if (!printer) return;
    const previous = this.seen.get(printer.serial);
    this.seen.set(printer.serial, printer);
    if (!previous || previous.host !== printer.host) {
      for (const l of [...this.listeners]) l(printer);
    }
    for (const w of [...this.waiters]) if (w.serial === printer.serial) w.resolve(printer);
  }

  private fail(port: number, error: unknown): void {
    const message = `UDP ${port}: ${error instanceof Error ? error.message : String(error)}`;
    if (!this.errors.includes(message)) this.errors.push(message);
    this.log(message);
  }
}
