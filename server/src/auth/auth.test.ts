// Must stay the first import: points DATA_DIR at a temp dir before
// db/client.ts opens the database.
import "../test/env.js";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance, InjectOptions } from "fastify";
import { sqlite } from "../db/client.js";
import { bootstrapDb } from "../db/bootstrap.js";
import { buildApp } from "../app.js";
import { getSettings } from "../config/settings.js";
import { clearLoginFailures, isLocalAddress, issueWsTicket, redeemWsTicket } from "./service.js";

const CSRF = { "x-requested-with": "arr-digest" };
const LAN_IP = "192.168.10.50";
const INTERNET_IP = "203.0.113.9";

let app: FastifyInstance;

before(async () => {
  bootstrapDb();
  app = await buildApp({ logger: false });
});

after(() => app.close());

beforeEach(() => {
  sqlite.exec("DELETE FROM auth; DELETE FROM sessions;");
  clearLoginFailures();
});

function call(opts: InjectOptions & { cookie?: string }) {
  const { cookie, headers, ...rest } = opts;
  return app.inject({
    remoteAddress: INTERNET_IP,
    ...rest,
    headers: { ...CSRF, ...(cookie ? { cookie } : {}), ...headers },
  });
}

// "arr_digest_session=abc; Path=/; ..." -> "arr_digest_session=abc"
function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const header = res.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  assert.ok(typeof value === "string", "expected a set-cookie header");
  return value.split(";")[0];
}

async function setup(username = "ethan", password = "correct horse") {
  const res = await call({ method: "POST", url: "/api/auth/setup", payload: { username, password } });
  assert.equal(res.statusCode, 200, res.body);
  return sessionCookie(res);
}

describe("first-run setup", () => {
  it("locks the API until a login is created, then only the first setup wins", async () => {
    const status = await call({ method: "GET", url: "/api/auth/status" });
    assert.deepEqual(status.json(), { setupRequired: true, authenticated: false });

    const blocked = await call({ method: "GET", url: "/api/settings" });
    assert.equal(blocked.statusCode, 401);
    assert.equal(blocked.json().setupRequired, true);

    const cookie = await setup();
    const ok = await call({ method: "GET", url: "/api/settings", cookie });
    assert.equal(ok.statusCode, 200);

    const again = await call({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "attacker", password: "whatever123" },
    });
    assert.equal(again.statusCode, 409);
  });

  it("rejects a short password", async () => {
    const res = await call({ method: "POST", url: "/api/auth/setup", payload: { username: "a", password: "short" } });
    assert.equal(res.statusCode, 400);
    assert.equal((await call({ method: "GET", url: "/api/auth/status" })).json().setupRequired, true);
  });

  it("never exposes the password hash through settings", async () => {
    const cookie = await setup();
    const body = (await call({ method: "GET", url: "/api/settings", cookie })).body;
    assert.ok(!body.includes("scrypt$"));
  });
});

describe("login", () => {
  it("accepts the right password (username case-insensitive) and rejects the wrong one", async () => {
    await setup("Ethan", "correct horse");

    const wrong = await call({ method: "POST", url: "/api/auth/login", payload: { username: "ethan", password: "nope nope" } });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.headers["set-cookie"], undefined);

    const right = await call({ method: "POST", url: "/api/auth/login", payload: { username: "ETHAN", password: "correct horse" } });
    assert.equal(right.statusCode, 200);
    const cookie = sessionCookie(right);
    assert.match(right.headers["set-cookie"] as string, /HttpOnly/);
    assert.doesNotMatch(right.headers["set-cookie"] as string, /Secure/, "plain-http LAN access would drop a Secure cookie");

    assert.equal((await call({ method: "GET", url: "/api/settings", cookie })).statusCode, 200);
  });

  it("marks the cookie Secure behind an HTTPS proxy", async () => {
    await setup();
    const res = await call({
      method: "POST",
      url: "/api/auth/login",
      headers: { "x-forwarded-proto": "https" },
      payload: { username: "ethan", password: "correct horse" },
    });
    assert.match(res.headers["set-cookie"] as string, /Secure/);
  });

  it("locks out an address after 10 failures, even for the right password", async () => {
    await setup();
    for (let i = 0; i < 10; i++) {
      const res = await call({ method: "POST", url: "/api/auth/login", payload: { username: "ethan", password: `guess-${i}xx` } });
      assert.equal(res.statusCode, 401);
    }
    const locked = await call({ method: "POST", url: "/api/auth/login", payload: { username: "ethan", password: "correct horse" } });
    assert.equal(locked.statusCode, 429);

    // A different address isn't affected.
    const other = await call({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "198.51.100.1",
      payload: { username: "ethan", password: "correct horse" },
    });
    assert.equal(other.statusCode, 200);
  });

  it("logout ends the session", async () => {
    const cookie = await setup();
    assert.equal((await call({ method: "POST", url: "/api/auth/logout", cookie })).statusCode, 200);
    assert.equal((await call({ method: "GET", url: "/api/settings", cookie })).statusCode, 401);
  });
});

describe("what stays reachable without a login", () => {
  it("health check and Sonarr/Radarr webhooks (which use their own token)", async () => {
    await setup();
    assert.equal((await app.inject({ method: "GET", url: "/api/health" })).statusCode, 200);

    const token = getSettings().webhookToken;
    // Sonarr doesn't send our CSRF header, and mustn't need to.
    const hook = await app.inject({
      method: "POST",
      url: `/api/webhooks/sonarr?token=${token}`,
      payload: { eventType: "Test" },
    });
    assert.equal(hook.statusCode, 200);

    const badToken = await app.inject({ method: "POST", url: "/api/webhooks/sonarr?token=nope", payload: { eventType: "Test" } });
    assert.equal(badToken.statusCode, 401);
  });

  it("can't be dodged with a percent-encoded path", async () => {
    await setup();
    for (const url of ["/%61pi/settings", "/api/%73ettings", "/api/settings?x=/api/health"]) {
      const res = await call({ method: "GET", url });
      assert.notEqual(res.statusCode, 200, url);
      assert.ok(!res.body.includes("webhookToken"), url);
    }
  });
});

describe("CSRF guard", () => {
  it("rejects state-changing requests without the header, even when logged in", async () => {
    const cookie = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/digest/run-now",
      remoteAddress: INTERNET_IP,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 403);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ethan", password: "correct horse" },
    });
    assert.equal(login.statusCode, 403);
  });
});

describe("local-network bypass", () => {
  async function enableBypass(cookie: string) {
    const res = await call({ method: "PUT", url: "/api/auth/mode", cookie, payload: { mode: "local_bypass" } });
    assert.equal(res.statusCode, 200, res.body);
  }

  it("is off by default", async () => {
    await setup();
    const res = await call({ method: "GET", url: "/api/settings", remoteAddress: LAN_IP });
    assert.equal(res.statusCode, 401);
  });

  it("lets LAN addresses in without a login, but not the internet or anything proxied", async () => {
    await enableBypass(await setup());

    for (const ip of [LAN_IP, "10.0.0.5", "172.20.0.1", "127.0.0.1", "::1", "::ffff:192.168.1.2", "fd00::1"]) {
      const res = await call({ method: "GET", url: "/api/settings", remoteAddress: ip });
      assert.equal(res.statusCode, 200, ip);
    }

    assert.equal((await call({ method: "GET", url: "/api/settings", remoteAddress: INTERNET_IP })).statusCode, 401);

    // A reverse proxy on the LAN forwarding an internet visitor.
    for (const header of ["x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip"]) {
      const res = await call({ method: "GET", url: "/api/settings", remoteAddress: LAN_IP, headers: { [header]: INTERNET_IP } });
      assert.equal(res.statusCode, 401, header);
    }

    const status = (await call({ method: "GET", url: "/api/auth/status", remoteAddress: LAN_IP })).json();
    assert.equal(status.bypassed, true);
  });

  it("switching back to required keeps the person who switched signed in", async () => {
    await enableBypass(await setup());
    const res = await call({ method: "PUT", url: "/api/auth/mode", remoteAddress: LAN_IP, payload: { mode: "required" } });
    assert.equal(res.statusCode, 200);
    const cookie = sessionCookie(res);

    assert.equal((await call({ method: "GET", url: "/api/settings", remoteAddress: LAN_IP })).statusCode, 401);
    assert.equal((await call({ method: "GET", url: "/api/settings", remoteAddress: LAN_IP, cookie })).statusCode, 200);
  });

  it("classifies addresses correctly", () => {
    assert.equal(isLocalAddress("192.168.0.1"), true);
    assert.equal(isLocalAddress("172.32.0.1"), false);
    assert.equal(isLocalAddress("fe80::1%eth0"), true);
    assert.equal(isLocalAddress("8.8.8.8"), false);
    assert.equal(isLocalAddress("::ffff:8.8.8.8"), false);
    assert.equal(isLocalAddress(undefined), false);
  });
});

describe("changing credentials", () => {
  it("needs the current password, and a new password signs out other sessions", async () => {
    const first = await setup("ethan", "correct horse");
    const login = await call({ method: "POST", url: "/api/auth/login", payload: { username: "ethan", password: "correct horse" } });
    const second = sessionCookie(login);

    const wrong = await call({
      method: "PUT",
      url: "/api/auth/credentials",
      cookie: first,
      payload: { currentPassword: "not it!!", newPassword: "battery staple" },
    });
    assert.equal(wrong.statusCode, 401);

    const changed = await call({
      method: "PUT",
      url: "/api/auth/credentials",
      cookie: first,
      payload: { currentPassword: "correct horse", username: "admin", newPassword: "battery staple" },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    const fresh = sessionCookie(changed);

    assert.equal((await call({ method: "GET", url: "/api/settings", cookie: second })).statusCode, 401);
    assert.equal((await call({ method: "GET", url: "/api/settings", cookie: fresh })).statusCode, 200);

    const newLogin = await call({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "battery staple" } });
    assert.equal(newLogin.statusCode, 200);
  });
});

describe("live feed WebSocket", () => {
  it("refuses a connection without a valid ticket", async () => {
    const cookie = await setup();
    // Even a logged-in cookie isn't enough on its own — a same-site page
    // could send that. It has to be a ticket fetched with the CSRF header.
    const res = await call({ method: "GET", url: "/api/ws", cookie });
    assert.equal(res.statusCode, 401);
  });

  it("tickets are single-use and require a live session", async () => {
    await setup();
    const bypass = issueWsTicket({ sessionHash: null, bypassed: true });
    assert.ok(redeemWsTicket(bypass));
    assert.equal(redeemWsTicket(bypass), null);

    const loggedOut = issueWsTicket({ sessionHash: "no-such-session", bypassed: false });
    assert.equal(redeemWsTicket(loggedOut), null);
  });

  it("issues a ticket only to a signed-in request", async () => {
    const cookie = await setup();
    assert.equal((await call({ method: "POST", url: "/api/auth/ws-ticket" })).statusCode, 401);
    const res = await call({ method: "POST", url: "/api/auth/ws-ticket", cookie });
    assert.equal(res.statusCode, 200);
    assert.ok(redeemWsTicket(res.json().ticket));
  });
});
