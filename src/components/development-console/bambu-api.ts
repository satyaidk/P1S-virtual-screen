/** Typed client for this app's own /api/bambu endpoints (credentials stay on the server). */

export interface SetupStatus {
  cloud: { signedIn: boolean; account: string | null; region: "global" | "china" | null };
  pendingLogin: { kind: "verifyCode" | "tfa"; account: string } | null;
  printer: {
    mode: "cloud" | "lan";
    name: string;
    maskedSerial: string;
    host: string | null;
  } | null;
  link: { status: string; error: string | null };
}

export interface AccountPrinter {
  serial: string;
  maskedSerial: string;
  name: string;
  online: boolean;
  productName: string;
  printStatus: string | null;
  hasAccessCode: boolean;
}

export type LoginStep = { step: "done" | "verifyCode" | "tfa" };

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/bambu/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
  return data as T;
}

export const bambuApi = {
  status: () => call<SetupStatus>("status"),
  login: (region: string, account: string, password: string) =>
    call<LoginStep>("login", { region, account, password }),
  emailCode: (region: string, account: string) =>
    call<LoginStep>("email-code", { region, account }),
  verify: (code: string) => call<LoginStep>("verify", { code }),
  devices: () => call<{ devices: AccountPrinter[] }>("devices").then((r) => r.devices),
  connectAccount: (serial: string, mode: "cloud" | "lan", host?: string) =>
    call<SetupStatus>("connect", { source: "account", serial, mode, host }),
  connectManual: (host: string, serial: string, accessCode: string) =>
    call<SetupStatus>("connect", { source: "manual", host, serial, accessCode }),
  disconnect: () => call<SetupStatus>("disconnect", {}),
  logout: () => call<SetupStatus>("logout", {}),
};
