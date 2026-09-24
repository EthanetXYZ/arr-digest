import crypto from "node:crypto";
import net from "node:net";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sqlite } from "../db/client.js";
import { hashPassword, verifyPassword } from "./password.js";

// "required": every browser request needs a login.
// "local_bypass": no login from a private/LAN address, like Sonarr's
// "Disabled for Local Addresses".
export type AuthMode = "required" | "local_bypass";
export const AUTH_MODES: AuthMode[] = ["required", "local_bypass"];

export const SESSION_COOKIE = "arr_digest_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Sliding expiry, but rewritten at most once a day per session rather than
// on every request.
const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export const MIN_PASSWORD_LENGTH = 8;

export interface Credentials {
  username: string;
  passwordHash: string;
  mode: AuthMode;
}

// How a request was let in. sessionHash is null when it came in through the
// local-network bypass rather than a login.
export interface AuthContext {
  sessionHash: string | null;
  bypassed: boolean;
}

export function getCredentials(): Credentials | null {
  const row = sqlite
    .prepare("SELECT username, password_hash AS passwordHash, mode FROM auth WHERE id = 1")
    .get() as Credentials | undefined;
  return row ?? null;
}

// Throws if credentials already exist: a plain INSERT on the id=1 row is
// what stops two racing first-run setups from both succeeding.
export async function createCredentials(username: string, password: string) {
  const hash = await hashPassword(password);
  sqlite
    .prepare("INSERT INTO auth (id, username, password_hash, mode, updated_at) VALUES (1, ?, ?, 'required', ?)")
    .run(username, hash, Date.now());
}

export async function updateCredentials(username: string, password: string | null) {
  const hash = password ? await hashPassword(password) : getCredentials()!.passwordHash;
  sqlite
    .prepare("UPDATE auth SET username = ?, password_hash = ?, updated_at = ? WHERE id = 1")
    .run(username, hash, Date.now());
}

export function setAuthMode(mode: AuthMode) {
  sqlite.prepare("UPDATE auth SET mode = ?, updated_at = ? WHERE id = 1").run(mode, Date.now());
}

// Forgotten-password recovery (cli/reset-auth.ts): the next visitor gets
// the first-run setup screen again.
export function clearCredentials() {
  sqlite.exec("DELETE FROM auth; DELETE FROM sessions;");
}

// A hash of the real password is compared even for an unknown username, so
// response time doesn't reveal whether the username was right.
let dummyHash: Promise<string> | null = null;

export async function checkLogin(username: string, password: string): Promise<boolean> {
  const creds = getCredentials();
  const usernameOk = !!creds && creds.username.toLowerCase() === username.trim().toLowerCase();
  const hash = creds?.passwordHash ?? (await (dummyHash ??= hashPassword("not-a-real-password")));
  const passwordOk = await verifyPassword(password, hash);
  return usernameOk && passwordOk;
}

export function validateUsername(username: unknown): string | null {
  if (typeof username !== "string" || !username.trim()) return "Username is required";
  if (username.trim().length > 64) return "Username must be 64 characters or fewer";
  return null;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  // scrypt handles any length, but there's no reason to hash megabytes.
  if (password.length > 256) return "Password must be 256 characters or fewer";
  return null;
}

// --- Sessions ---------------------------------------------------------------

// Only a hash of the token is stored, so a copy of the database (e.g. an
// appdata backup) can't be used to log in.
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSession(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = Date.now();
  sqlite
    .prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .run(tokenHash, now, now + SESSION_TTL_MS);
  return { token, tokenHash };
}

function findSession(token: string): { tokenHash: string; expiresAt: number } | null {
  const tokenHash = hashToken(token);
  const row = sqlite
    .prepare("SELECT expires_at AS expiresAt FROM sessions WHERE token_hash = ?")
    .get(tokenHash) as { expiresAt: number } | undefined;
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    deleteSession(tokenHash);
    return null;
  }
  return { tokenHash, expiresAt: row.expiresAt };
}

export function deleteSession(tokenHash: string) {
  sqlite.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteAllSessions() {
  sqlite.exec("DELETE FROM sessions");
}

export function pruneExpiredSessions(): number {
  return sqlite.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now()).changes;
}

// --- Cookies ----------------------------------------------------------------

function readCookie(req: FastifyRequest, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// Secure only when the browser is actually on HTTPS (directly, or via a
// TLS-terminating proxy); on plain http://<lan-ip> the browser would drop a
// Secure cookie and login would silently never stick.
function isHttps(req: FastifyRequest): boolean {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return req.protocol === "https" || proto === "https";
}

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isHttps(req)) attrs.push("Secure");
  reply.header("set-cookie", attrs.join("; "));
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// --- Local-network detection -----------------------------------------------

const LOCAL_RANGES = new net.BlockList();
LOCAL_RANGES.addSubnet("127.0.0.0", 8, "ipv4");
LOCAL_RANGES.addSubnet("10.0.0.0", 8, "ipv4");
LOCAL_RANGES.addSubnet("172.16.0.0", 12, "ipv4");
LOCAL_RANGES.addSubnet("192.168.0.0", 16, "ipv4");
LOCAL_RANGES.addSubnet("169.254.0.0", 16, "ipv4");
LOCAL_RANGES.addAddress("::1", "ipv6");
LOCAL_RANGES.addSubnet("fc00::", 7, "ipv6");
LOCAL_RANGES.addSubnet("fe80::", 10, "ipv6");

export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  let ip = address.split("%")[0]; // IPv6 zone id, e.g. fe80::1%eth0
  if (ip.toLowerCase().startsWith("::ffff:") && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (net.isIPv4(ip)) return LOCAL_RANGES.check(ip, "ipv4");
  if (net.isIPv6(ip)) return LOCAL_RANGES.check(ip, "ipv6");
  return false;
}

// Headers a reverse proxy or tunnel adds. Behind one, the connection comes
// from the proxy — usually a LAN address — even when the real visitor is on
// the internet, so any request carrying these is treated as not local.
// Forwarded IPs are never trusted either: they're trivially spoofable.
const FORWARDING_HEADERS = ["x-forwarded-for", "forwarded", "x-real-ip", "cf-connecting-ip", "via"];

export function isDirectLocalRequest(req: FastifyRequest): boolean {
  if (FORWARDING_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  return isLocalAddress(req.socket.remoteAddress);
}

// --- Resolving a request ---------------------------------------------------

export function resolveAuth(req: FastifyRequest, reply?: FastifyReply): AuthContext | null {
  const creds = getCredentials();
  if (!creds) return null;

  const token = readCookie(req, SESSION_COOKIE);
  const session = token ? findSession(token) : null;
  if (session && token) {
    if (reply && session.expiresAt - Date.now() < SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS) {
      sqlite
        .prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
        .run(Date.now() + SESSION_TTL_MS, session.tokenHash);
      setSessionCookie(req, reply, token);
    }
    return { sessionHash: session.tokenHash, bypassed: false };
  }

  if (creds.mode === "local_bypass" && isDirectLocalRequest(req)) {
    return { sessionHash: null, bypassed: true };
  }
  return null;
}

// --- WebSocket tickets -----------------------------------------------------

// Browsers can't add headers to a WebSocket handshake, so the CSRF header
// check can't cover /api/ws. Instead the page fetches a single-use ticket
// through a normal (header-checked) request and connects with it — a page
// on another origin can't read that response, so it can't open the feed.
const TICKET_TTL_MS = 30_000;
const tickets = new Map<string, { auth: AuthContext; expiresAt: number }>();

export function issueWsTicket(auth: AuthContext): string {
  const now = Date.now();
  for (const [key, t] of tickets) if (t.expiresAt <= now) tickets.delete(key);
  const ticket = crypto.randomBytes(24).toString("base64url");
  tickets.set(ticket, { auth, expiresAt: now + TICKET_TTL_MS });
  return ticket;
}

export function redeemWsTicket(ticket: unknown): AuthContext | null {
  if (typeof ticket !== "string") return null;
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  // The session may have been logged out in the few seconds since.
  if (entry.auth.sessionHash) {
    const exists = sqlite
      .prepare("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?")
      .get(entry.auth.sessionHash, Date.now());
    if (!exists) return null;
  }
  return entry.auth;
}

// --- Login throttling ------------------------------------------------------

// Keyed on the connecting address, not X-Forwarded-For (which the attacker
// controls). Behind a reverse proxy that means everyone shares one bucket,
// so a brute-force attempt locks the login for everyone for a while —
// preferable to letting it continue.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 10;
const loginFailures = new Map<string, { count: number; firstAt: number }>();

export function loginRetryAfterMs(ip: string): number {
  const entry = loginFailures.get(ip);
  if (!entry) return 0;
  const elapsed = Date.now() - entry.firstAt;
  if (elapsed >= LOGIN_WINDOW_MS) {
    loginFailures.delete(ip);
    return 0;
  }
  return entry.count >= MAX_LOGIN_FAILURES ? LOGIN_WINDOW_MS - elapsed : 0;
}

export function noteLoginFailure(ip: string) {
  const entry = loginFailures.get(ip);
  if (entry && Date.now() - entry.firstAt < LOGIN_WINDOW_MS) entry.count += 1;
  else loginFailures.set(ip, { count: 1, firstAt: Date.now() });
}

export function clearLoginFailures(ip?: string) {
  if (ip === undefined) loginFailures.clear();
  else loginFailures.delete(ip);
}
