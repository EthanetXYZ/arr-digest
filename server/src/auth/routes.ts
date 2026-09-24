import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { closeClients } from "../realtime/ws.js";
import {
  AUTH_MODES,
  checkLogin,
  clearLoginFailures,
  clearSessionCookie,
  createCredentials,
  createSession,
  deleteAllSessions,
  deleteSession,
  getCredentials,
  isDirectLocalRequest,
  issueWsTicket,
  loginRetryAfterMs,
  noteLoginFailure,
  redeemWsTicket,
  resolveAuth,
  setAuthMode,
  setSessionCookie,
  updateCredentials,
  validatePassword,
  validateUsername,
  type AuthContext,
  type AuthMode,
} from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

// Every non-GET API call from the web UI carries this header. A plain HTML
// form on another site can't set custom headers, and a cross-origin fetch
// that does gets blocked by the browser's CORS preflight (this app never
// answers one) — so a malicious page can't make your browser change
// settings or send digests using your login cookie.
export const CSRF_HEADER = "x-requested-with";
export const CSRF_HEADER_VALUE = "arr-digest";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Reachable without logging in.
const PUBLIC_ROUTES = new Set(["/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/setup", "/api/auth/logout"]);

async function authHook(req: FastifyRequest, reply: FastifyReply) {
  // The route that actually matched, not req.url: the router decodes the
  // path, so a check on the raw URL could be dodged with e.g. /%61pi/settings.
  const route = req.routeOptions.url;
  // Static web assets and 404s. The SPA shell itself isn't secret; all
  // data comes from /api.
  if (!route?.startsWith("/api/")) return;
  // Sonarr/Radarr can't log in; these check their own ?token= instead.
  if (route.startsWith("/api/webhooks/")) return;

  if (!SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
    return reply.code(403).send({ error: `Missing ${CSRF_HEADER} header` });
  }

  if (PUBLIC_ROUTES.has(route)) return;

  if (route === "/api/ws") {
    req.auth = redeemWsTicket((req.query as { ticket?: unknown }).ticket);
    if (!req.auth) return reply.code(401).send({ error: "Invalid or expired ticket" });
    return;
  }

  req.auth = resolveAuth(req, reply);
  if (!req.auth) {
    const setupRequired = !getCredentials();
    return reply.code(401).send({ error: setupRequired ? "Setup required" : "Not signed in", setupRequired });
  }
}

function status(req: FastifyRequest, auth: AuthContext | null) {
  const creds = getCredentials();
  if (!creds) return { setupRequired: true, authenticated: false };
  if (!auth) return { setupRequired: false, authenticated: false };
  return {
    setupRequired: false,
    authenticated: true,
    bypassed: auth.bypassed,
    username: creds.username,
    mode: creds.mode,
    localNetwork: isDirectLocalRequest(req),
  };
}

function signIn(req: FastifyRequest, reply: FastifyReply): AuthContext {
  const { token, tokenHash } = createSession();
  setSessionCookie(req, reply, token);
  return { sessionHash: tokenHash, bypassed: false };
}

// Called directly on the root instance, NOT via app.register(): Fastify
// scopes hooks to the plugin that adds them, so registering this as a
// plugin would leave every other route unguarded.
export function registerAuth(app: FastifyInstance) {
  app.decorateRequest("auth", null);
  app.addHook("onRequest", authHook);

  app.get("/api/auth/status", async (req, reply) => status(req, resolveAuth(req, reply)));

  app.post<{ Body: { username?: unknown; password?: unknown } }>("/api/auth/setup", async (req, reply) => {
    if (getCredentials()) return reply.code(409).send({ error: "A login already exists" });
    const { username, password } = req.body ?? {};
    const invalid = validateUsername(username) ?? validatePassword(password);
    if (invalid) return reply.code(400).send({ error: invalid });

    try {
      await createCredentials((username as string).trim(), password as string);
    } catch {
      // Lost a race with a concurrent setup.
      return reply.code(409).send({ error: "A login already exists" });
    }
    return status(req, signIn(req, reply));
  });

  app.post<{ Body: { username?: unknown; password?: unknown } }>("/api/auth/login", async (req, reply) => {
    if (!getCredentials()) return reply.code(409).send({ error: "Setup required", setupRequired: true });

    const ip = req.socket.remoteAddress ?? "unknown";
    const retryAfter = loginRetryAfterMs(ip);
    if (retryAfter > 0) {
      const minutes = Math.ceil(retryAfter / 60_000);
      return reply
        .code(429)
        .header("retry-after", Math.ceil(retryAfter / 1000))
        .send({ error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` });
    }

    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string" || !(await checkLogin(username, password))) {
      noteLoginFailure(ip);
      return reply.code(401).send({ error: "Incorrect username or password" });
    }

    clearLoginFailures(ip);
    return status(req, signIn(req, reply));
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const auth = resolveAuth(req);
    if (auth?.sessionHash) {
      deleteSession(auth.sessionHash);
      closeClients((s) => s === auth.sessionHash);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post("/api/auth/ws-ticket", async (req) => ({ ticket: issueWsTicket(req.auth!) }));

  app.put<{ Body: { currentPassword?: unknown; username?: unknown; newPassword?: unknown } }>(
    "/api/auth/credentials",
    async (req, reply) => {
      const creds = getCredentials()!;
      const { currentPassword, username, newPassword } = req.body ?? {};
      // Even on the local-network bypass: whoever's at the keyboard has to
      // know the current password to replace it.
      if (typeof currentPassword !== "string" || !(await checkLogin(creds.username, currentPassword))) {
        return reply.code(401).send({ error: "Current password is incorrect" });
      }

      const nextUsername = username === undefined ? creds.username : username;
      const invalid =
        validateUsername(nextUsername) ??
        (newPassword === undefined || newPassword === "" ? null : validatePassword(newPassword));
      if (invalid) return reply.code(400).send({ error: invalid });

      const passwordChanged = typeof newPassword === "string" && newPassword !== "";
      await updateCredentials((nextUsername as string).trim(), passwordChanged ? (newPassword as string) : null);

      if (!passwordChanged) return status(req, req.auth);

      // A new password signs out every other browser; this one gets a
      // fresh session so it stays logged in.
      deleteAllSessions();
      closeClients((s) => s !== null);
      return status(req, signIn(req, reply));
    },
  );

  app.put<{ Body: { mode?: unknown } }>("/api/auth/mode", async (req, reply) => {
    const mode = req.body?.mode;
    if (!AUTH_MODES.includes(mode as AuthMode)) {
      return reply.code(400).send({ error: `mode must be one of ${AUTH_MODES.join(", ")}` });
    }
    setAuthMode(mode as AuthMode);
    // Live feeds that got in via the bypass lose that right now.
    if (mode === "required") closeClients((s) => s === null);
    // Whoever made the change was allowed in when they did, so keep them
    // signed in rather than bouncing them to the login screen.
    return status(req, req.auth?.bypassed ? signIn(req, reply) : req.auth);
  });
}
