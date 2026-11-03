"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fieldClass as input } from "@/components/ui/field";
import { Panel } from "@/components/ui/Panel";
import { usePrinter, useRuntime } from "@/hooks/usePrinter";
import { cn } from "@/lib/cn";
import { bambuApi, type AccountPrinter, type SetupStatus } from "./bambu-api";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
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
  const runtime = useRuntime();
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
      // Re-open the display stream so it picks up the new printer/session right away.
      await runtime.provider.disconnect();
      await runtime.provider.connect();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Connect your printer"
      description="Live data from your P1S drives the display."
      testId="printer-setup"
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <CurrentConnection
          status={status}
          busy={busy}
          onDisconnect={() => run("disconnect", bambuApi.disconnect)}
        />
        {status?.hosted && <HostedNotice setupError={status.setupError} />}
        {status && !status.hosted && <MyPrinterCard status={status} busy={busy} run={run} />}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/60 bg-danger-soft px-3 py-2 text-fg"
            data-testid="setup-error"
          >
            {error}
          </p>
        )}
        {status?.hosted ? (
          <div className="rounded-md border border-line bg-bench p-3" data-testid="hosted-sign-in">
            {!signedIn && <SignIn status={status} busy={busy} run={run} />}
            {signedIn && (
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
          </div>
        ) : (
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
        )}
        {status && !status.hosted && (
          <Collapsible title="A different printer (IP, serial and access code)">
            <ManualLan busy={busy} run={run} />
          </Collapsible>
        )}
      </div>
    </Panel>
  );
}

/** Shown on the hosted (Vercel) site: what works here and what needs the home computer. */
function HostedNotice({ setupError }: { setupError: string | null }) {
  return (
    <div className="flex flex-col gap-2" data-testid="hosted-notice">
      {setupError && (
        <p role="alert" className="rounded-md border border-warn/60 bg-warn-soft px-3 py-2 text-fg">
          {setupError}
        </p>
      )}
      <p className="leading-5 text-fg-muted">
        <strong className="text-fg">Online version.</strong> Sign in with the Bambu account your
        printer is bound to and the display shows it live through Bambu Cloud, from anywhere. It is{" "}
        <strong className="text-fg">view-only</strong>: Bambu blocks control over the cloud, and the
        access code only works from a computer on the printer&apos;s Wi-Fi (run{" "}
        <code className="font-mono">npm run dev</code> there for controls).
      </p>
      <p className="leading-5 text-fg-muted" data-testid="remote-control-hint">
        <strong className="text-fg">Control from anywhere:</strong> run this app on a computer at
        home and reach it from your phone over Tailscale.{" "}
        <a
          href="https://github.com/satyaidk/P1S-virtual-screen/blob/main/docs/remote-access.md"
          target="_blank"
          rel="noreferrer"
          className="text-fg underline underline-offset-2"
        >
          Step-by-step guide
        </a>
      </p>
    </div>
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
    <div className="rounded-md border border-line">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left font-medium text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-mat-ink"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <ChevronRight
          size={16}
          aria-hidden
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
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
      className="flex flex-col gap-3 rounded-md border border-line bg-bench p-3"
      data-testid="my-printer"
    >
      <div>
        <div className="text-[14px] font-semibold">{mine.name}</div>
        <div className="text-[12px] text-fg-muted">
          {mine.model} · SN {mine.maskedSerial} (built in)
        </div>
      </div>
      <div className="flex items-center gap-2 text-fg-muted" data-testid="discovery-status">
        <span className={cn("size-2 shrink-0 rounded-full", network.tone)} aria-hidden />
        {network.text}
      </div>
      {mine.discoveryProblems.length > 0 && mine.hostSource === null && (
        <p className="text-warn">
          Network discovery is blocked ({mine.discoveryProblems.join("; ")}). Enter the IP below.
        </p>
      )}
      <Field label="Access code">
        <div className="flex gap-2">
          <input
            className={cn(input, "w-full flex-1 font-mono tracking-widest")}
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
      <p className="text-[12px] leading-5 text-fg-muted">
        On the printer:{" "}
        <strong className="font-medium text-fg">Settings → Network (WLAN) → Access Code</strong> (8
        characters). This is the LAN code, not the 6-digit PIN from “Bind with PIN code”. Controls
        need <strong className="font-medium text-fg">LAN Only + Developer Mode</strong> enabled on
        the printer; otherwise you still get live data.
      </p>
      <button
        type="button"
        className="self-start text-info hover:underline focus-visible:outline-2 focus-visible:outline-mat-ink"
        onClick={() => setShowHost(!showHost)}
      >
        {showHost ? "Use automatic discovery" : "Printer not found? Enter its IP"}
      </button>
      {showHost && (
        <Field label="Printer IP (printer screen → Settings → Network)">
          <input
            className={cn(input, "w-full")}
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
  // What the display actually receives (accurate in both local and hosted mode).
  const connection = usePrinter((s) => s.state.connection);
  const link = { status: connection.status, error: connection.lastError };
  const tone =
    link.status === "connected"
      ? "text-ok"
      : link.status === "connecting"
        ? "text-info"
        : "text-danger";
  return (
    <div
      className="rounded-md border border-line bg-bench px-3 py-2.5"
      data-testid="current-connection"
    >
      {status?.printer ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {status.printer.name}{" "}
              <span className="font-normal text-fg-dim">{status.printer.maskedSerial}</span>
            </div>
            <div className="text-[12px] text-fg-muted">
              via{" "}
              {status.printer.mode === "cloud"
                ? "Bambu Cloud (read-only)"
                : `LAN ${status.printer.host}`}{" "}
              ·{" "}
              <span className={tone} data-testid="link-status">
                {link.status}
              </span>
              {link.error && <span className="text-fg-dim"> — {link.error}</span>}
            </div>
          </div>
          <Button onClick={onDisconnect} disabled={busy !== null}>
            Disconnect
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-fg-muted">
          <span aria-hidden className="size-2 rounded-full bg-fg-dim" />
          No printer connected yet.
        </p>
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
      <h3 className="font-semibold text-fg">Sign in to Bambu Lab</h3>
      <div className="grid grid-cols-[100px_1fr] gap-2">
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
      <p className="text-[12px] leading-5 text-fg-muted">
        {status.hosted
          ? "Your password is sent once to Bambu Lab and never stored. The sign-in is kept only in an encrypted cookie in this browser."
          : "Your password is sent once to Bambu Lab by this app's local server and is never stored."}
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
        <h3 className="flex-1 font-semibold text-fg">
          Choose your printer{" "}
          <span className="font-normal text-fg-muted">({status.cloud.account})</span>
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
          className="rounded-md border border-line p-3"
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
            {!status.hosted && (
              <>
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
              </>
            )}
          </div>
        </div>
      ))}
      {!status.hosted && (
        <p className="text-[12px] leading-5 text-fg-muted">
          Bambu Cloud works from anywhere but is read-only (current firmware rejects unsigned
          control). LAN gives control when the printer has LAN Only + Developer Mode enabled; find
          its IP on the printer under Settings → Network.
        </p>
      )}
    </div>
  );
}

function ManualLan({ busy, run }: { busy: string | null; run: Run }) {
  const [host, setHost] = useState("");
  const [serial, setSerial] = useState("");
  const [code, setCode] = useState("");
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
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
      <p className="self-center text-[12px] text-fg-muted">
        Only for a printer other than the built-in one.
      </p>
      <Button type="submit" variant="primary" disabled={busy !== null || !host || !serial || !code}>
        Connect
      </Button>
    </form>
  );
}
