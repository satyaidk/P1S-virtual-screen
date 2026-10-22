"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { bambuApi, type AccountPrinter, type SetupStatus } from "./bambu-api";

const input =
  "h-8 min-w-0 rounded-md border border-ink-600 bg-ink-850 px-2 text-xs text-fg placeholder:text-fg-dim";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-2xs text-fg-muted">
      {label}
      {children}
    </label>
  );
}

/**
 * Connect the display to the real printer. The serial number is built in and the printer's IP is
 * found on the network automatically, so the normal flow is: type the access code, press Connect.
 * Credentials go to this app's local server only; the browser never stores them.
 *
 * Alternatives (collapsed): Bambu Cloud sign-in (read-only) and a fully manual LAN connection.
 */
export function PrinterSetup() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [printers, setPrinters] = useState<AccountPrinter[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await bambuApi.status());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), 3000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  const signedIn = status?.cloud.signedIn ?? false;
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    bambuApi
      .devices()
      .then((d) => !cancelled && setPrinters(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Printer connection" testId="printer-setup">
      <div className="flex flex-col gap-4 text-xs">
        <CurrentConnection
          status={status}
          busy={busy}
          onDisconnect={() => run("disconnect", bambuApi.disconnect)}
        />
        {status && <MyPrinterCard status={status} busy={busy} run={run} />}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/60 bg-danger-soft px-2 py-1.5 text-fg"
            data-testid="setup-error"
          >
            {error}
          </p>
        )}
        <Collapsible
          title="View through Bambu Cloud instead (read-only, sign in)"
          defaultOpen={signedIn}
        >
          {status && !signedIn && <SignIn status={status} busy={busy} run={run} />}
          {status && signedIn && (
            <AccountPrinters
              status={status}
              printers={printers}
              busy={busy}
              run={run}
              onSignOut={() =>
                run("logout", async () => {
                  await bambuApi.logout();
                  setPrinters(null);
                })
              }
            />
          )}
        </Collapsible>
        <Collapsible title="A different printer (IP, serial and access code)">
          <ManualLan busy={busy} run={run} />
        </Collapsible>
      </div>
    </Panel>
  );
}

function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-ink-700">
      <button
        type="button"
        className="w-full px-2.5 py-2 text-left text-2xs font-semibold text-fg-muted hover:text-fg"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} {title}
      </button>
      {open && <div className="px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

function ago(ts: number | null): string {
  if (ts === null) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 2 ? "just now" : `${s}s ago`;
}

/** The built-in printer: serial from the code, IP from discovery; user types the access code. */
function MyPrinterCard({
  status,
  busy,
  run,
}: {
  status: SetupStatus;
  busy: string | null;
  run: Run;
}) {
  const [code, setCode] = useState("");
  const [host, setHost] = useState("");
  const [showHost, setShowHost] = useState(false);
  const mine = status.myPrinter;
  const connectedHere =
    status.printer?.mode === "lan" && status.printer.maskedSerial === mine.maskedSerial;

  const network =
    mine.hostSource === "discovered"
      ? { tone: "bg-ok", text: `Found on your network at ${mine.host} (${ago(mine.lastSeen)})` }
      : mine.hostSource === "configured"
        ? { tone: "bg-ok", text: `IP set in configuration: ${mine.host}` }
        : mine.hostSource === "saved"
          ? { tone: "bg-warn", text: `Not announcing right now — last known IP ${mine.host}` }
          : { tone: "bg-info", text: "Searching your network for the printer…" };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run("access-code", () =>
      bambuApi.connectAccessCode(code, showHost ? host : undefined).then(() => setCode("")),
    );
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2.5 rounded-md border border-ink-600 p-3"
      data-testid="my-printer"
    >
      <div>
        <div className="text-sm font-semibold">{mine.name}</div>
        <div className="text-2xs text-fg-dim">
          {mine.model} · SN {mine.maskedSerial} (built in)
        </div>
      </div>
      <div
        className="flex items-center gap-2 text-2xs text-fg-muted"
        data-testid="discovery-status"
      >
        <span className={cn("size-2 shrink-0 rounded-full", network.tone)} aria-hidden />
        {network.text}
      </div>
      {mine.discoveryProblems.length > 0 && mine.hostSource === null && (
        <p className="text-2xs text-warn">
          Network discovery is blocked ({mine.discoveryProblems.join("; ")}). Enter the IP below.
        </p>
      )}
      <Field label="Access code">
        <div className="flex gap-2">
          <input
            className={cn(input, "w-40 font-mono tracking-widest")}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 12345678"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            data-testid="access-code"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={busy !== null || code.length < 6 || (showHost && !host)}
            data-testid="connect-access-code"
          >
            {busy === "access-code"
              ? mine.host || showHost
                ? "Connecting…"
                : "Looking for printer…"
              : connectedHere
                ? "Reconnect"
                : "Connect"}
          </Button>
        </div>
      </Field>
      <p className="text-2xs leading-4 text-fg-dim">
        On the printer:{" "}
        <strong className="text-fg-muted">Settings → Network (WLAN) → Access Code</strong> (8
        characters). This is the LAN code, not the 6-digit PIN from “Bind with PIN code”. Controls
        need <strong className="text-fg-muted">LAN Only + Developer Mode</strong> enabled on the
        printer; otherwise you still get live data.
      </p>
      <button
        type="button"
        className="self-start text-2xs text-info hover:underline"
        onClick={() => setShowHost(!showHost)}
      >
        {showHost ? "Use automatic discovery" : "Printer not found? Enter its IP"}
      </button>
      {showHost && (
        <Field label="Printer IP (printer screen → Settings → Network)">
          <input
            className={cn(input, "w-48")}
            placeholder="192.168.1.50"
            value={host}
            onChange={(e) => setHost(e.target.value.trim())}
            data-testid="access-code-host"
          />
        </Field>
      )}
    </form>
  );
}

type Run = (label: string, action: () => Promise<unknown>) => Promise<void>;

function CurrentConnection({
  status,
  busy,
  onDisconnect,
}: {
  status: SetupStatus | null;
  busy: string | null;
  onDisconnect: () => void;
}) {
  const link = status?.link;
  const tone =
    link?.status === "connected"
      ? "text-ok"
      : link?.status === "connecting"
        ? "text-info"
        : "text-danger";
  return (
    <div
      className="rounded-md border border-ink-700 bg-ink-850 p-2.5"
      data-testid="current-connection"
    >
      {status?.printer ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {status.printer.name}{" "}
              <span className="font-normal text-fg-dim">{status.printer.maskedSerial}</span>
            </div>
            <div className="text-2xs text-fg-muted">
              via{" "}
              {status.printer.mode === "cloud"
                ? "Bambu Cloud (read-only)"
                : `LAN ${status.printer.host}`}{" "}
              ·{" "}
              <span className={tone} data-testid="link-status">
                {link?.status}
              </span>
              {link?.error && <span className="text-fg-dim"> — {link.error}</span>}
            </div>
          </div>
          <Button onClick={onDisconnect} disabled={busy !== null}>
            Disconnect
          </Button>
        </div>
      ) : (
        <p className="text-fg-muted">No printer connected yet.</p>
      )}
    </div>
  );
}

function SignIn({ status, busy, run }: { status: SetupStatus; busy: string | null; run: Run }) {
  const [region, setRegion] = useState<"global" | "china">("global");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const pending = status.pendingLogin;

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run("login", () =>
      bambuApi.login(region, account, password).finally(() => setPassword("")),
    );
  };

  if (pending) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("verify", () => bambuApi.verify(code).then(() => setCode("")));
        }}
      >
        <p className="text-fg-muted">
          {pending.kind === "tfa"
            ? "Enter the code from your authenticator app."
            : `Bambu emailed a verification code to ${pending.account}.`}
        </p>
        <div className="flex gap-2">
          <input
            className={cn(input, "w-32 tracking-widest")}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            data-testid="login-code"
          />
          <Button type="submit" variant="primary" disabled={busy !== null || code.length < 4}>
            {busy === "verify" ? "Verifying…" : "Verify"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={submitPassword} data-testid="sign-in">
      <h3 className="text-2xs font-semibold tracking-wide text-fg-muted uppercase">
        1 · Sign in to Bambu Lab
      </h3>
      <div className="grid grid-cols-[110px_1fr] gap-2">
        <Field label="Region">
          <select
            className={input}
            value={region}
            onChange={(e) => setRegion(e.target.value as "global" | "china")}
          >
            <option value="global">Global</option>
            <option value="china">China</option>
          </select>
        </Field>
        <Field label="Email (Bambu account)">
          <input
            className={input}
            type="email"
            autoComplete="username"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            data-testid="login-account"
          />
        </Field>
      </div>
      <Field label="Password (optional — or use an emailed code)">
        <input
          className={input}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="login-password"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy !== null || !account || !password}>
          {busy === "login" ? "Signing in…" : "Sign in"}
        </Button>
        <Button
          disabled={busy !== null || !account.includes("@")}
          onClick={() => void run("code", () => bambuApi.emailCode(region, account))}
          data-testid="email-code"
        >
          {busy === "code" ? "Sending…" : "Email me a code"}
        </Button>
      </div>
      <p className="text-2xs text-fg-dim">
        Your password is sent once to Bambu Lab by this app&apos;s local server and is never stored.
      </p>
    </form>
  );
}

function AccountPrinters({
  status,
  printers,
  busy,
  run,
  onSignOut,
}: {
  status: SetupStatus;
  printers: AccountPrinter[] | null;
  busy: string | null;
  run: Run;
  onSignOut: () => void;
}) {
  const [hosts, setHosts] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
          2 · Choose your printer <span className="normal-case">({status.cloud.account})</span>
        </h3>
        <Button onClick={onSignOut} disabled={busy !== null}>
          Sign out
        </Button>
      </div>
      {printers === null && <p className="text-fg-dim">Loading printers…</p>}
      {printers?.length === 0 && (
        <p className="text-fg-muted">No printers are bound to this account.</p>
      )}
      {printers?.map((p) => (
        <div
          key={p.serial}
          className="rounded-md border border-ink-700 p-2.5"
          data-testid="account-printer"
        >
          <div className="flex items-center gap-2">
            <span
              className={cn("size-2 rounded-full", p.online ? "bg-ok" : "bg-fg-dim")}
              aria-hidden
            />
            <span className="font-semibold">{p.name}</span>
            <span className="text-fg-dim">
              {p.productName} · {p.maskedSerial} · {p.online ? "online" : "offline"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() => void run("cloud", () => bambuApi.connectAccount(p.serial, "cloud"))}
              data-testid="connect-cloud"
            >
              View via Bambu Cloud
            </Button>
            <span className="text-fg-dim">or</span>
            <input
              className={cn(input, "w-36")}
              placeholder="Printer IP, e.g. 192.168.1.50"
              value={hosts[p.serial] ?? ""}
              onChange={(e) => setHosts({ ...hosts, [p.serial]: e.target.value.trim() })}
            />
            <Button
              disabled={busy !== null || !hosts[p.serial] || !p.hasAccessCode}
              onClick={() =>
                void run("lan", () => bambuApi.connectAccount(p.serial, "lan", hosts[p.serial]))
              }
            >
              Connect via LAN
            </Button>
          </div>
        </div>
      ))}
      <p className="text-2xs leading-4 text-fg-dim">
        Bambu Cloud works from anywhere but is read-only (current firmware rejects unsigned
        control). LAN gives control when the printer has LAN Only + Developer Mode enabled; find its
        IP on the printer under Settings → Network.
      </p>
    </div>
  );
}

function ManualLan({ busy, run }: { busy: string | null; run: Run }) {
  const [host, setHost] = useState("");
  const [serial, setSerial] = useState("");
  const [code, setCode] = useState("");
  return (
    <form
      className="grid grid-cols-3 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run("manual", () =>
          bambuApi.connectManual(host, serial, code).then(() => setCode("")),
        );
      }}
    >
      <Field label="Printer IP">
        <input className={input} value={host} onChange={(e) => setHost(e.target.value.trim())} />
      </Field>
      <Field label="Serial number">
        <input
          className={input}
          value={serial}
          onChange={(e) => setSerial(e.target.value.trim())}
        />
      </Field>
      <Field label="LAN access code">
        <input
          className={input}
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
        />
      </Field>
      <p className="col-span-2 self-center text-2xs text-fg-dim">
        Only for a printer other than the built-in one.
      </p>
      <Button type="submit" variant="primary" disabled={busy !== null || !host || !serial || !code}>
        Connect
      </Button>
    </form>
  );
}
