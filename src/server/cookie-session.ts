import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Encrypted, tamper-proof cookies for hosted deployments, where the server has no disk.
 * AES-256-GCM with a key derived from P1S_SESSION_SECRET. Cookies are HttpOnly + Secure +
 * SameSite=Strict, so page scripts cannot read them and other sites cannot send them.
 */

export const SESSION_COOKIE = "p1s_session";
export const LOGIN_COOKIE = "p1s_login";
const MIN_SECRET_LENGTH = 32;

export const cloudSessionSchema = z.object({
  v: z.literal(1),
  region: z.enum(["global", "china"]),
  account: z.string(),
  token: z.string(),
  mqttUsername: z.string(),
  expiresAt: z.number().nullable(),
  printer: z.object({ serial: z.string(), name: z.string() }).nullable(),
});
export type CookieSession = z.infer<typeof cloudSessionSchema>;

export const pendingLoginSchema = z.object({
  v: z.literal(1),
  region: z.enum(["global", "china"]),
  account: z.string(),
  kind: z.enum(["verifyCode", "tfa"]),
  tfaKey: z.string().optional(),
});
export type PendingLogin = z.infer<typeof pendingLoginSchema>;

export class MissingSecretError extends Error {
  constructor() {
    super(
      "This deployment needs a session secret: in Vercel → Project → Settings → Environment Variables add P1S_SESSION_SECRET (any random text of 32+ characters), then redeploy.",
    );
    this.name = "MissingSecretError";
  }
}

export function sessionKey(secret = process.env.P1S_SESSION_SECRET): Buffer | null {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return createHash("sha256").update(`p1s-session:${secret}`).digest();
}

export function seal(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

/** Returns null for anything that was not sealed with this key (tampered, old key, garbage). */
export function unseal<T>(sealed: string, key: Buffer, schema: z.ZodType<T>): T | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(
      "utf8",
    );
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export function clearCookie(name: string): string {
  return serializeCookie(name, "", 0);
}

export function readSession(req: Request, key: Buffer): CookieSession | null {
  const raw = readCookie(req, SESSION_COOKIE);
  const session = raw ? unseal(raw, key, cloudSessionSchema) : null;
  if (session && session.expiresAt !== null && session.expiresAt < Date.now()) return null;
  return session;
}

export function readPendingLogin(req: Request, key: Buffer): PendingLogin | null {
  const raw = readCookie(req, LOGIN_COOKIE);
  return raw ? unseal(raw, key, pendingLoginSchema) : null;
}

/** Bambu tokens last about 3 months; never keep the cookie longer than that. */
const MAX_SESSION_SECONDS = 90 * 24 * 3600;

export function sessionCookie(session: CookieSession, key: Buffer): string {
  const seconds = session.expiresAt
    ? Math.min(MAX_SESSION_SECONDS, (session.expiresAt - Date.now()) / 1000)
    : MAX_SESSION_SECONDS;
  return serializeCookie(SESSION_COOKIE, seal(session, key), seconds);
}

export function pendingLoginCookie(pending: PendingLogin, key: Buffer): string {
  return serializeCookie(LOGIN_COOKIE, seal(pending, key), 15 * 60);
}
