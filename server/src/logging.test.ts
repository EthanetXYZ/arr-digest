// Must stay the first import: points DATA_DIR at a temp dir before
// db/client.ts opens the database.
import "./test/env.js";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { bootstrapDb } from "./db/bootstrap.js";
import { buildApp, redactUrl } from "./app.js";
import { getSettings } from "./config/settings.js";

describe("request logging", () => {
  it("redacts the webhook token and WebSocket ticket from URLs", () => {
    assert.equal(redactUrl("/api/webhooks/sonarr?token=abc123"), "/api/webhooks/sonarr?token=[redacted]");
    assert.equal(redactUrl("/api/ws?x=1&ticket=abc&y=2"), "/api/ws?x=1&ticket=[redacted]&y=2");
    assert.equal(redactUrl("/api/x?TOKEN=abc"), "/api/x?TOKEN=[redacted]");
    assert.equal(redactUrl("/api/x?mytoken=abc"), "/api/x?mytoken=abc");
    assert.equal(redactUrl("/api/settings"), "/api/settings");
  });

  it("never writes the webhook token to the server log", async () => {
    bootstrapDb();
    const lines: string[] = [];
    const stream = new PassThrough();
    stream.on("data", (chunk) => lines.push(chunk.toString()));

    const app = await buildApp({ logStream: stream });
    const token = getSettings().webhookToken;
    await app.inject({ method: "POST", url: `/api/webhooks/sonarr?token=${token}`, payload: { eventType: "Test" } });
    await app.inject({ method: "POST", url: "/api/webhooks/radarr?token=wrong-guess", payload: { eventType: "Test" } });
    await app.inject({ method: "GET", url: "/api/ws?ticket=secret-ticket" });
    await app.close();

    const log = lines.join("");
    assert.match(log, /\/api\/webhooks\/sonarr\?token=\[redacted\]/, "the request should still be logged");
    assert.ok(!log.includes(token), "real token leaked into the log");
    assert.ok(!log.includes("wrong-guess"));
    assert.ok(!log.includes("secret-ticket"));
  });
});
