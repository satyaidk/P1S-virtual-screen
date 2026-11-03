import "server-only";
import mqtt from "mqtt";
import type { BridgeServerMessage } from "@/printer/protocol/bridge-protocol";
import {
  BambuCloudClient,
  CLOUD_MQTT_HOST,
  CloudError,
  type CloudDevice,
  type CloudRegion,
  type LoginResult,
} from "./bambu-cloud";
import {
  clearCookie,
  LOGIN_COOKIE,
  MissingSecretError,
  pendingLoginCookie,
  readPendingLogin,
  readSession,
  SESSION_COOKIE,
  sessionCookie,
  sessionKey,
  type CookieSession,
} from "./cookie-session";
import { PrinterLink, type MqttConnect } from "./printer-link";
import { myPrinter, type MyPrinter } from "./printer-config";
import { NO_CLOUD_HISTORY, type CloudContext } from "./print-history";
import { maskAccount, maskSerial } from "./session-store";

/**
 * Bambu Cloud mode for hosted deployments (Vercel). Nothing is stored on the server: the Bambu
 * token and the chosen printer live in the visitor's own encrypted cookie, and every display
 * stream opens its own short-lived MQTT connection to Bambu's cloud broker.
 *
 * Cloud connections are read-only (current firmware rejects unsigned control), and the LAN access
 * code cannot be used because a hosted server cannot reach the home network.
 */

export interface HostedResult {
  body: unknown;
  cookies: string[];
}

export const HOSTED_LAN_UNAVAILABLE =
  "The access code (LAN) only works when this app runs on a computer on the printer's Wi-Fi. On this hosted site, sign in with your Bambu account instead (view-only).";

export const HOSTED_NOT_SIGNED_IN =
  "Not connected yet — sign in with your Bambu account on the console";

export interface HostedServiceOptions {
  fetchImpl?: typeof fetch;
  connect?: MqttConnect;
  printer?: () => MyPrinter;
  secret?: () => string | undefined;
}

export class HostedService {
  private readonly fetchImpl: typeof fetch;
  private readonly connect: MqttConnect;
  private readonly printerConfig: () => MyPrinter;
  private readonly secret: () => string | undefined;

  constructor(options: HostedServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.connect = options.connect ?? (mqtt.connect as unknown as MqttConnect);
    this.printerConfig = options.printer ?? myPrinter;
    this.secret = options.secret ?? (() => process.env.P1S_SESSION_SECRET);
  }

  /** null when P1S_SESSION_SECRET is missing: sign-in is impossible until it is configured. */
  private key(): Buffer | null {
    return sessionKey(this.secret());
  }

  private requireKey(): Buffer {
    const key = this.key();
    if (!key) throw new MissingSecretError();
    return key;
  }

  status(req: Request): HostedResult {
    const key = this.key();
    const session = key ? readSession(req, key) : null;
    const pending = key ? readPendingLogin(req, key) : null;
    const mine = this.printerConfig();
    return {
      cookies: [],
      body: {
        hosted: true,
        setupError: key ? null : new MissingSecretError().message,
        myPrinter: {
          name: mine.name,
          model: mine.model,
          maskedSerial: maskSerial(mine.serial),
          host: null,
          hostSource: null,
          lastSeen: null,
          discoveryProblems: [],
        },
        cloud: {
          signedIn: session !== null,
          account: session ? maskAccount(session.account) : null,
          region: session?.region ?? null,
        },
        pendingLogin: pending
          ? { kind: pending.kind, account: maskAccount(pending.account) }
          : null,
        printer: session?.printer
          ? {
              mode: "cloud",
              name: session.printer.name,
              maskedSerial: maskSerial(session.printer.serial),
              host: null,
            }
          : null,
        link: { status: session?.printer ? "cloud" : "disconnected", error: null },
      },
    };
  }

  async loginWithPassword(
    region: CloudRegion,
    account: string,
    password: string,
  ): Promise<HostedResult> {
    const key = this.requireKey();
    const client = this.cloud(region);
    const result = await client.login(account, password);
    if (result.kind === "verifyCode") await client.sendEmailCode(account);
    return this.handleLogin(key, region, account, result);
  }

  async requestEmailCode(region: CloudRegion, account: string): Promise<HostedResult> {
    const key = this.requireKey();
    await this.cloud(region).sendEmailCode(account);
    return {
      body: { step: "verifyCode" },
      cookies: [pendingLoginCookie({ v: 1, region, account, kind: "verifyCode" }, key)],
    };
  }

  async submitCode(req: Request, code: string): Promise<HostedResult> {
    const key = this.requireKey();
    const pending = readPendingLogin(req, key);
    if (!pending) throw new CloudError("The sign-in expired — start again", 400);
    const client = this.cloud(pending.region);
    const result =
      pending.kind === "tfa" && pending.tfaKey
        ? await client.loginWithTfa(pending.tfaKey, code)
        : await client.loginWithCode(pending.account, code);
    return this.handleLogin(key, pending.region, pending.account, result);
  }

  async listDevices(req: Request): Promise<HostedResult> {
    const key = this.requireKey();
    const session = this.requireSession(req, key);
    const devices = await this.devices(session);
    return {
      cookies: [],
      body: {
        devices: devices.map((d) => ({
          serial: d.serial,
          maskedSerial: maskSerial(d.serial),
          name: d.name,
          online: d.online,
          productName: d.productName || d.model,
          printStatus: d.printStatus,
          // The LAN access code is useless on a hosted site; never advertise it.
          hasAccessCode: false,
        })),
      },
    };
  }

  async connectAccountPrinter(
    req: Request,
    serial: string,
    mode: "cloud" | "lan",
  ): Promise<HostedResult> {
    if (mode === "lan") throw new CloudError(HOSTED_LAN_UNAVAILABLE, 400);
    const key = this.requireKey();
    const session = this.requireSession(req, key);
    const device = (await this.devices(session)).find((d) => d.serial === serial);
    if (!device) throw new CloudError("That printer is not bound to this Bambu account", 404);
    const next = { ...session, printer: { serial: device.serial, name: device.name } };
    return {
      body: this.status(withSession(req, next, key)).body,
      cookies: [sessionCookie(next, key)],
    };
  }

  disconnect(req: Request): HostedResult {
    const key = this.requireKey();
    const session = readSession(req, key);
    if (!session) return { body: { ok: true }, cookies: [] };
    const next = { ...session, printer: null };
    return { body: { ok: true }, cookies: [sessionCookie(next, key)] };
  }

  logout(): HostedResult {
    return {
      body: { ok: true },
      cookies: [clearCookie(SESSION_COOKIE), clearCookie(LOGIN_COOKIE)],
    };
  }

  /**
   * Opens a cloud MQTT link for one display stream. Returns null (after sending an explanatory
   * hello/printer_link) when there is no usable session.
   */
  openStream(
    req: Request,
    send: (msg: BridgeServerMessage) => void,
    options: { resume: boolean },
  ): PrinterLink | null {
    const key = this.key();
    const session = key ? readSession(req, key) : null;
    if (!session?.printer) {
      send({
        type: "hello",
        protocol: 2,
        printer: null,
        mode: null,
        commands: [],
        readOnlyReason: null,
      });
      send({
        type: "printer_link",
        status: "disconnected",
        error: key ? HOSTED_NOT_SIGNED_IN : new MissingSecretError().message,
      });
      return null;
    }
    const link = new PrinterLink({ connect: this.connect });
    link.start(
      {
        mode: "cloud",
        serial: session.printer.serial,
        name: session.printer.name,
        model: "P1S",
        url: `mqtts://${CLOUD_MQTT_HOST[session.region]}:8883`,
        username: session.mqttUsername,
        password: session.token,
        tls: { rejectUnauthorized: true },
      },
      // A reconnecting display already has the full state; don't make the printer resend it.
      { requestFullStatus: !options.resume },
    );
    link.subscribe(send);
    return link;
  }

  /** Token + selected printer for print history / cover requests. */
  cloudContext(req: Request): CloudContext {
    const key = this.requireKey();
    const session = readSession(req, key);
    if (!session) throw new CloudError(NO_CLOUD_HISTORY, 401);
    if (!session.printer) throw new CloudError("Choose a printer first", 400);
    return {
      client: this.cloud(session.region),
      token: session.token,
      serial: session.printer.serial,
    };
  }

  // --- internals -------------------------------------------------------------------------

  private cloud(region: CloudRegion): BambuCloudClient {
    return new BambuCloudClient(region, this.fetchImpl);
  }

  private requireSession(req: Request, key: Buffer): CookieSession {
    const session = readSession(req, key);
    if (!session) throw new CloudError("Sign in to your Bambu account first", 401);
    return session;
  }

  private async devices(session: CookieSession): Promise<CloudDevice[]> {
    try {
      return await this.cloud(session.region).listDevices(session.token);
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) {
        throw new CloudError("Bambu session expired — sign in again", 401);
      }
      throw e;
    }
  }

  private async handleLogin(
    key: Buffer,
    region: CloudRegion,
    account: string,
    result: LoginResult,
  ): Promise<HostedResult> {
    if (result.kind === "verifyCode" || result.kind === "tfa") {
      return {
        body: { step: result.kind },
        cookies: [
          pendingLoginCookie(
            {
              v: 1,
              region,
              account,
              kind: result.kind,
              tfaKey: result.kind === "tfa" ? result.tfaKey : undefined,
            },
            key,
          ),
        ],
      };
    }
    const client = this.cloud(region);
    const session: CookieSession = {
      v: 1,
      region,
      account,
      token: result.token,
      mqttUsername: await client.getMqttUsername(result.token),
      expiresAt: result.expiresIn ? Date.now() + result.expiresIn * 1000 : null,
      printer: null,
    };
    // Pick the built-in printer automatically (or the only printer on the account).
    const devices = await client.listDevices(result.token).catch(() => [] as CloudDevice[]);
    const mine = this.printerConfig();
    const chosen =
      devices.find((d) => d.serial === mine.serial) ??
      (devices.length === 1 ? devices[0] : undefined);
    if (chosen) session.printer = { serial: chosen.serial, name: chosen.name };
    return {
      body: { step: "done" },
      cookies: [sessionCookie(session, key), clearCookie(LOGIN_COOKIE)],
    };
  }
}

/** A request clone carrying a freshly issued session cookie (to build a status reply). */
function withSession(req: Request, session: CookieSession, key: Buffer): Request {
  const cookie = sessionCookie(session, key).split(";")[0]!;
  return new Request(req.url, { headers: { cookie } });
}

let instance: HostedService | null = null;
export function getHostedService(): HostedService {
  instance ??= new HostedService();
  return instance;
}
