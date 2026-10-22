import type { UdpSocketFactory, UdpSocketLike } from "@/server/discovery";

type MessageCb = (msg: Buffer, rinfo: { address: string; port: number }) => void;

export class FakeUdpSocket implements UdpSocketLike {
  port: number | null = null;
  memberships: string[] = [];
  broadcast = false;
  sent: { msg: string; port: number; address: string }[] = [];
  closed = false;
  private messageCbs: MessageCb[] = [];
  private errorCbs: ((e: Error) => void)[] = [];

  constructor(private readonly failBind: Error | null = null) {}

  on(event: "message" | "error", cb: MessageCb | ((e: Error) => void)): this {
    if (event === "message") this.messageCbs.push(cb as MessageCb);
    else this.errorCbs.push(cb as (e: Error) => void);
    return this;
  }
  bind(port: number, cb?: () => void): this {
    if (this.failBind) {
      queueMicrotask(() => this.errorCbs.forEach((c) => c(this.failBind!)));
      return this;
    }
    this.port = port;
    cb?.();
    return this;
  }
  addMembership(group: string): void {
    this.memberships.push(group);
  }
  setBroadcast(flag: boolean): void {
    this.broadcast = flag;
  }
  send(msg: string, port: number, address: string): this {
    this.sent.push({ msg, port, address });
    return this;
  }
  close(): void {
    this.closed = true;
  }
  /** Simulate a datagram arriving. */
  receive(text: string, address = "192.168.1.64"): void {
    for (const cb of this.messageCbs) cb(Buffer.from(text), { address, port: 1990 });
  }
}

export function fakeUdpFactory(options: { failBind?: Error } = {}) {
  const sockets: FakeUdpSocket[] = [];
  const factory: UdpSocketFactory = () => {
    const s = new FakeUdpSocket(options.failBind ?? null);
    sockets.push(s);
    return s;
  };
  return { factory, sockets };
}

export function bambuNotify(serial: string, host: string, name = "My P1S"): string {
  return [
    "NOTIFY * HTTP/1.1",
    "Host: 239.255.255.250:1990",
    "Server: Buildroot/2018.02-rc3 UPnP/1.0 ssdpd/1.8",
    `Location: ${host}`,
    "NT: urn:bambulab-com:device:3dprinter:1",
    "NTS: ssdp:alive",
    `USN: ${serial}`,
    "Cache-Control: max-age=1800",
    "DevModel.bambu.com: C12",
    `DevName.bambu.com: ${name}`,
    "DevSignal.bambu.com: -48",
    "DevConnect.bambu.com: cloud",
    "DevBind.bambu.com: occupied",
    "",
    "",
  ].join("\r\n");
}
