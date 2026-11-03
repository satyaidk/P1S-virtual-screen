import "server-only";
import mqtt from "mqtt";
import { BAMBU_PRINTER_CA } from "./bambu-ca";
import {
  BambuCloudClient,
  CLOUD_MQTT_HOST,
  CloudError,
  type CloudDevice,
  type CloudRegion,
  type LoginResult,
} from "./bambu-cloud";
import { PrinterDiscovery, type DiscoveredPrinter } from "./discovery";
import { PrinterLink, type LinkConfig, type MqttConnect } from "./printer-link";
import { myPrinter, type MyPrinter } from "./printer-config";
import {
  clearState,
  loadState,
  maskAccount,
  maskSerial,
  saveState,
  type PrinterTarget,
  type StoredState,
} from "./session-store";
import { NO_CLOUD_HISTORY, type CloudContext } from "./print-history";

/**
 * Server-side composition: cloud sign-in, printer selection and the MQTT link.
 * One instance per server process (see getBridgeService).
 */

export interface PublicDevice {
  serial: string;
  maskedSerial: string;
  name: string;
  online: boolean;
  productName: string;
  printStatus: string | null;
  hasAccessCode: boolean;
}

export interface PublicStatus {
  /** true on Vercel-style deployments (Bambu Cloud only, cookie sessions). */
  hosted: boolean;
  /** Configuration problem that blocks sign-in (hosted only). */
  setupError: string | null;
  /** The printer this app is configured for (serial built in; IP discovered). */
  myPrinter: {
    name: string;
    model: string;
    maskedSerial: string;
    host: string | null;
    hostSource: "configured" | "discovered" | "saved" | null;
    lastSeen: number | null;
    discoveryProblems: string[];
  };
  cloud: { signedIn: boolean; account: string | null; region: CloudRegion | null };
  pendingLogin: { kind: "verifyCode" | "tfa"; account: string } | null;
  printer: {
    mode: "cloud" | "lan";
    name: string;
    maskedSerial: string;
    host: string | null;
  } | null;
  link: { status: string; error: string | null };
}

export type LoginStep = { step: "done" } | { step: "verifyCode" } | { step: "tfa" };

const HOST_RE =
  /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9-]{1,63})*)$/;
const SERIAL_RE = /^[A-Za-z0-9]{8,32}$/;
const ACCESS_CODE_RE = /^[A-Za-z0-9]{6,16}$/;

export interface BridgeServiceOptions {
  connect?: MqttConnect;
  fetchImpl?: typeof fetch;
  discovery?: PrinterDiscovery;
  printer?: () => MyPrinter;
  /** How long "Connect" waits for the printer to announce itself on the network. */
  discoveryTimeoutMs?: number;
}

export class BridgeService {
  readonly link: PrinterLink;
  readonly discovery: PrinterDiscovery;
  private readonly fetchImpl: typeof fetch;
  private readonly printerConfig: () => MyPrinter;
  private readonly discoveryTimeoutMs: number;
  private stored: StoredState = { cloud: null, printer: null };
  private ready: Promise<void> | null = null;
  private pending: {
    region: CloudRegion;
    account: string;
    kind: "verifyCode" | "tfa";
    tfaKey?: string;
  } | null = null;

  constructor(options: BridgeServiceOptions = {}) {
    this.link = new PrinterLink({
      connect: options.connect ?? (mqtt.connect as unknown as MqttConnect),
    });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.discovery = options.discovery ?? new PrinterDiscovery();
    this.printerConfig = options.printer ?? myPrinter;
    this.discoveryTimeoutMs = options.discoveryTimeoutMs ?? 15_000;
  }

  /** Load the saved session once, start listening for the printer, reconnect if configured. */
  init(): Promise<void> {
    this.ready ??= (async () => {
      this.stored = await loadState();
      this.discovery.start();
      this.discovery.onFound((p) => void this.onPrinterFound(p));
      if (this.stored.printer) this.startLink(this.stored.printer);
    })();
    return this.ready;
  }

  /**
   * The normal way to connect: only the printer's LAN access code is typed. The serial comes from
   * printer-config.ts and the IP from network discovery (or BAMBU_PRINTER_HOST / an override).
   */
  async connectWithAccessCode(accessCode: string, hostOverride?: string): Promise<void> {
    const code = accessCode.trim();
    if (!ACCESS_CODE_RE.test(code)) {
      throw new CloudError(
        "The access code is the 8 characters shown on the printer under Settings → Network",
        400,
      );
    }
    const printer = this.printerConfig();
    let host = hostOverride?.trim() || printer.host;
    let hostSource: "auto" | "manual" = host ? "manual" : "auto";
    if (host && !HOST_RE.test(host)) throw new CloudError("Invalid IP address", 400);
    let name = printer.name;

    if (!host) {
      const found = await this.discovery.waitFor(printer.serial, this.discoveryTimeoutMs);
      if (found) {
        host = found.host;
        name = found.name || name;
      } else {
        const saved = this.stored.printer;
        if (saved?.mode === "lan" && saved.serial === printer.serial) {
          host = saved.host;
          hostSource = saved.hostSource ?? "manual";
        }
      }
    }
    if (!host) {
      throw new CloudError(
        "Printer not found on this network. Make sure this computer is on the same Wi-Fi as the printer and the printer is on, or enter its IP under “Printer not found?”.",
        404,
      );
    }
    await this.setPrinter({
      mode: "lan",
      serial: printer.serial,
      name,
      host,
      accessCode: code,
      hostSource,
    });
  }

  status(): PublicStatus {
    const { cloud, printer } = this.stored;
    const link = this.link.current;
    const mine = this.printerConfig();
    const found = this.discovery.get(mine.serial);
    const saved = printer?.mode === "lan" && printer.serial === mine.serial ? printer.host : null;
    return {
      hosted: false,
      setupError: null,
      myPrinter: {
        name: found?.name || mine.name,
        model: mine.model,
        maskedSerial: maskSerial(mine.serial),
        host: mine.host ?? found?.host ?? saved,
        hostSource: mine.host ? "configured" : found ? "discovered" : saved ? "saved" : null,
        lastSeen: found?.lastSeen ?? null,
        discoveryProblems: [...this.discovery.problems],
      },
      cloud: {
        signedIn: cloud !== null,
        account: cloud ? maskAccount(cloud.account) : null,
        region: cloud?.region ?? null,
      },
      pendingLogin: this.pending
        ? { kind: this.pending.kind, account: maskAccount(this.pending.account) }
        : null,
      printer: printer
        ? {
            mode: printer.mode,
            name: printer.name,
            maskedSerial: maskSerial(printer.serial),
            host: printer.mode === "lan" ? printer.host : null,
          }
        : null,
      link: { status: link.status, error: link.error },
    };
  }

  async loginWithPassword(
    region: CloudRegion,
    account: string,
    password: string,
  ): Promise<LoginStep> {
    const client = this.cloud(region);
    const result = await client.login(account, password);
    if (result.kind === "verifyCode") await client.sendEmailCode(account);
    return this.handleLogin(region, account, result);
  }

  async requestEmailCode(region: CloudRegion, account: string): Promise<LoginStep> {
    await this.cloud(region).sendEmailCode(account);
    this.pending = { region, account, kind: "verifyCode" };
    return { step: "verifyCode" };
  }

  async submitCode(code: string): Promise<LoginStep> {
    const pending = this.pending;
    if (!pending) throw new CloudError("No sign-in in progress", 400);
    const client = this.cloud(pending.region);
    const result =
      pending.kind === "tfa" && pending.tfaKey
        ? await client.loginWithTfa(pending.tfaKey, code)
        : await client.loginWithCode(pending.account, code);
    return this.handleLogin(pending.region, pending.account, result);
  }

  async listDevices(): Promise<PublicDevice[]> {
    const devices = await this.cloudDevices();
    return devices.map((d) => ({
      serial: d.serial,
      maskedSerial: maskSerial(d.serial),
      name: d.name,
      online: d.online,
      productName: d.productName || d.model,
      printStatus: d.printStatus,
      hasAccessCode: Boolean(d.accessCode),
    }));
  }

  /** Connect to a printer bound to the signed-in account, via the cloud broker or the LAN. */
  async connectAccountPrinter(serial: string, mode: "cloud" | "lan", host?: string): Promise<void> {
    const device = (await this.cloudDevices()).find((d) => d.serial === serial);
    if (!device) throw new CloudError("That printer is not bound to this Bambu account", 404);
    let target: PrinterTarget;
    if (mode === "cloud") {
      target = { mode: "cloud", serial, name: device.name };
    } else {
      if (!host || !HOST_RE.test(host)) throw new CloudError("Enter the printer's IP address", 400);
      if (!device.accessCode)
        throw new CloudError("Bambu did not provide the LAN access code; enter it manually", 400);
      target = { mode: "lan", serial, name: device.name, host, accessCode: device.accessCode };
    }
    await this.setPrinter(target);
  }

  /** A different printer than the built-in one: IP + serial + access code typed by hand. */
  async connectLanManual(
    host: string,
    serial: string,
    accessCode: string,
    name?: string,
  ): Promise<void> {
    if (!HOST_RE.test(host)) throw new CloudError("Invalid IP address or host name", 400);
    if (!SERIAL_RE.test(serial)) throw new CloudError("Invalid serial number", 400);
    if (!ACCESS_CODE_RE.test(accessCode)) throw new CloudError("Invalid access code", 400);
    await this.setPrinter({
      mode: "lan",
      serial: serial.toUpperCase(),
      name: name?.trim() || "P1S",
      host,
      accessCode,
      hostSource: "manual",
    });
  }

  async disconnectPrinter(): Promise<void> {
    this.link.stop("Disconnected");
    this.stored = { ...this.stored, printer: null };
    await this.persist();
  }

  async signOut(): Promise<void> {
    this.link.stop("Signed out");
    this.stored = { cloud: null, printer: null };
    this.pending = null;
    await clearState();
  }

  // --- internals -------------------------------------------------------------------------

  /** Follow the printer when DHCP gives it a new IP address. */
  private async onPrinterFound(found: DiscoveredPrinter): Promise<void> {
    const target = this.stored.printer;
    if (target?.mode !== "lan" || target.serial !== found.serial) return;
    if (target.hostSource !== "auto" || target.host === found.host) return;
    await this.setPrinter({ ...target, host: found.host });
  }

  /**
   * Token + current printer for print history / cover requests. Works in LAN mode too, as long as
   * the user also signed in to the Bambu account (the access code alone gives no cloud access).
   */
  cloudContext(): CloudContext {
    const cloud = this.stored.cloud;
    if (!cloud) throw new CloudError(NO_CLOUD_HISTORY, 401);
    const serial = this.stored.printer?.serial;
    if (!serial) throw new CloudError("Connect a printer first", 400);
    return { client: this.cloud(cloud.region), token: cloud.token, serial };
  }

  private cloud(region: CloudRegion): BambuCloudClient {
    return new BambuCloudClient(region, this.fetchImpl);
  }

  private async handleLogin(
    region: CloudRegion,
    account: string,
    result: LoginResult,
  ): Promise<LoginStep> {
    if (result.kind === "verifyCode") {
      this.pending = { region, account, kind: "verifyCode" };
      return { step: "verifyCode" };
    }
    if (result.kind === "tfa") {
      this.pending = { region, account, kind: "tfa", tfaKey: result.tfaKey };
      return { step: "tfa" };
    }
    const mqttUsername = await this.cloud(region).getMqttUsername(result.token);
    this.stored = {
      ...this.stored,
      cloud: {
        region,
        account,
        token: result.token,
        mqttUsername,
        expiresAt: result.expiresIn ? Date.now() + result.expiresIn * 1000 : null,
      },
    };
    this.pending = null;
    await this.persist();
    return { step: "done" };
  }

  private async cloudDevices(): Promise<CloudDevice[]> {
    const cloud = this.stored.cloud;
    if (!cloud) throw new CloudError("Sign in to your Bambu account first", 401);
    try {
      return await this.cloud(cloud.region).listDevices(cloud.token);
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) {
        this.stored = { ...this.stored, cloud: null };
        await this.persist();
        throw new CloudError("Bambu session expired — sign in again", 401);
      }
      throw e;
    }
  }

  private async setPrinter(target: PrinterTarget): Promise<void> {
    this.stored = { ...this.stored, printer: target };
    await this.persist();
    this.startLink(target);
  }

  private startLink(target: PrinterTarget): void {
    const config = this.linkConfig(target);
    if (!config) {
      this.link.stop("Bambu session expired — sign in again");
      return;
    }
    this.link.start(config);
  }

  private linkConfig(target: PrinterTarget): LinkConfig | null {
    if (target.mode === "lan") {
      return {
        mode: "lan",
        serial: target.serial,
        name: target.name,
        model: "P1S",
        url: `mqtts://${target.host}:8883`,
        username: "bblp",
        password: target.accessCode,
        // The printer's certificate is issued by Bambu's CA to CN=<serial>: verify that via SNI.
        tls: { ca: BAMBU_PRINTER_CA, servername: target.serial, rejectUnauthorized: true },
      };
    }
    const cloud = this.stored.cloud;
    if (!cloud) return null;
    return {
      mode: "cloud",
      serial: target.serial,
      name: target.name,
      model: "P1S",
      url: `mqtts://${CLOUD_MQTT_HOST[cloud.region]}:8883`,
      username: cloud.mqttUsername,
      password: cloud.token,
      tls: { rejectUnauthorized: true },
    };
  }

  private persist(): Promise<void> {
    return saveState(this.stored);
  }
}

const globalKey = Symbol.for("p1s-virtual-screen.bridge-service");

/** Process-wide singleton (survives dev-server hot reloads). */
export function getBridgeService(): BridgeService {
  const g = globalThis as unknown as Record<symbol, BridgeService | undefined>;
  g[globalKey] ??= new BridgeService();
  return g[globalKey];
}
