import "server-only";

/**
 * Minimal Bambu Lab cloud HTTP client (community-documented API: OpenBambuAPI cloud-http.md,
 * ha-bambulab bambu_cloud.py). Runs on the server only; tokens never reach the browser.
 *
 * Login flows the API answers with:
 *  - accessToken directly (password accepted)
 *  - loginType "verifyCode": an email code is required → sendEmailCode + loginWithCode
 *  - loginType "tfa": a 2FA (authenticator) code is required → loginWithTfa
 */

export type CloudRegion = "global" | "china";

export interface CloudDevice {
  serial: string;
  name: string;
  online: boolean;
  model: string;
  productName: string;
  printStatus: string | null;
  /** LAN access code as reported by the cloud. Server-side only. */
  accessCode: string | null;
}

export type LoginResult =
  | { kind: "token"; token: string; expiresIn: number | null }
  | { kind: "verifyCode" }
  | { kind: "tfa"; tfaKey: string };

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null = null,
  ) {
    super(message);
    this.name = "CloudError";
  }
}

type FetchLike = typeof fetch;

const API_HOST: Record<CloudRegion, string> = {
  global: "https://api.bambulab.com",
  china: "https://api.bambulab.cn",
};

const WEB_HOST: Record<CloudRegion, string> = {
  global: "https://bambulab.com",
  china: "https://bambulab.cn",
};

export const CLOUD_MQTT_HOST: Record<CloudRegion, string> = {
  global: "us.mqtt.bambulab.com",
  china: "cn.mqtt.bambulab.com",
};

const HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": "p1s-virtual-screen/0.2",
};

export class BambuCloudClient {
  constructor(
    readonly region: CloudRegion,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async login(account: string, password: string): Promise<LoginResult> {
    const body = await this.post("/v1/user-service/user/login", {
      account,
      password,
      apiError: "",
    });
    return this.toLoginResult(body);
  }

  /** Ask Bambu to email a one-time login code ("codeLogin"). */
  async sendEmailCode(email: string): Promise<void> {
    await this.post("/v1/user-service/user/sendemail/code", { email, type: "codeLogin" });
  }

  async loginWithCode(account: string, code: string): Promise<LoginResult> {
    const body = await this.post("/v1/user-service/user/login", { account, code });
    return this.toLoginResult(body);
  }

  /** 2FA login goes through the website host and needs its CSRF cookie (ha-bambulab flow). */
  async loginWithTfa(tfaKey: string, tfaCode: string): Promise<LoginResult> {
    const csrf = await this.fetchImpl(`${WEB_HOST[this.region]}/api/csrf`, { headers: HEADERS });
    const cookie = csrf.headers.get("set-cookie") ?? "";
    const csrfToken = /bbl_csrf_token=([^;]+)/.exec(cookie)?.[1];
    if (!csrfToken)
      throw new CloudError("Could not obtain the 2FA security token from Bambu", csrf.status);

    const res = await this.fetchImpl(`${WEB_HOST[this.region]}/api/sign-in/tfa`, {
      method: "POST",
      headers: { ...HEADERS, "x-bbl-csrf-token": csrfToken, cookie: `bbl_csrf_token=${csrfToken}` },
      body: JSON.stringify({ tfaKey, tfaCode }),
    });
    await this.assertOk(res);
    const token = /(?:^|[;,\s])token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
    if (!token) throw new CloudError("2FA accepted but no token was returned", res.status);
    return { kind: "token", token, expiresIn: null };
  }

  /** MQTT username is "u_{uid}". Taken from the JWT when possible, else from preferences. */
  async getMqttUsername(token: string): Promise<string> {
    const fromJwt = usernameFromJwt(token);
    if (fromJwt) return fromJwt;
    const body = await this.get("/v1/design-user-service/my/preference", token);
    const uid = (body as { uid?: unknown }).uid;
    if (typeof uid !== "number" && typeof uid !== "string") {
      throw new CloudError("Bambu did not return a user id", 500);
    }
    return `u_${uid}`;
  }

  async listDevices(token: string): Promise<CloudDevice[]> {
    const body = (await this.get("/v1/iot-service/api/user/bind", token)) as { devices?: unknown };
    const devices = Array.isArray(body.devices) ? body.devices : [];
    return devices.flatMap((d): CloudDevice[] => {
      if (typeof d !== "object" || d === null) return [];
      const r = d as Record<string, unknown>;
      if (typeof r.dev_id !== "string") return [];
      return [
        {
          serial: r.dev_id,
          name: typeof r.name === "string" ? r.name : r.dev_id,
          online: r.online === true,
          model: typeof r.dev_model_name === "string" ? r.dev_model_name : "",
          productName: typeof r.dev_product_name === "string" ? r.dev_product_name : "",
          printStatus: typeof r.print_status === "string" ? r.print_status : null,
          accessCode: typeof r.dev_access_code === "string" ? r.dev_access_code.trim() : null,
        },
      ];
    });
  }

  private toLoginResult(body: unknown): LoginResult {
    const b = body as {
      accessToken?: unknown;
      loginType?: unknown;
      tfaKey?: unknown;
      expiresIn?: unknown;
    };
    if (typeof b.accessToken === "string" && b.accessToken !== "") {
      return {
        kind: "token",
        token: b.accessToken,
        expiresIn: typeof b.expiresIn === "number" ? b.expiresIn : null,
      };
    }
    if (b.loginType === "verifyCode") return { kind: "verifyCode" };
    if (b.loginType === "tfa" && typeof b.tfaKey === "string")
      return { kind: "tfa", tfaKey: b.tfaKey };
    throw new CloudError("Unexpected login response from Bambu", 500);
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${API_HOST[this.region]}${path}`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(payload),
    });
    await this.assertOk(res);
    return res.json().catch(() => ({}));
  }

  private async get(path: string, token: string): Promise<unknown> {
    const res = await this.fetchImpl(`${API_HOST[this.region]}${path}`, {
      headers: { ...HEADERS, authorization: `Bearer ${token}` },
    });
    await this.assertOk(res);
    return res.json();
  }

  private async assertOk(res: Response): Promise<void> {
    if (res.ok) return;
    const text = await res.text().catch(() => "");
    if (res.status === 403 && /cloudflare/i.test(text)) {
      throw new CloudError("Blocked by Bambu's Cloudflare protection. Try again later.", 403);
    }
    let message = `Bambu cloud error (HTTP ${res.status})`;
    let code: number | null = null;
    try {
      const json = JSON.parse(text) as { error?: unknown; message?: unknown; code?: unknown };
      if (typeof json.error === "string" && json.error) message = json.error;
      else if (typeof json.message === "string" && json.message) message = json.message;
      if (typeof json.code === "number") code = json.code;
    } catch {
      /* non-JSON body */
    }
    throw new CloudError(message, res.status, code);
  }
}

export function usernameFromJwt(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      username?: unknown;
    };
    return typeof payload.username === "string" ? payload.username : null;
  } catch {
    return null;
  }
}
