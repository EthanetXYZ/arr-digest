import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { webhookRoutes } from "./webhooks/routes.js";
import { settingsRoutes } from "./api/settings.routes.js";
import { eventsRoutes } from "./api/events.routes.js";
import { systemRoutes } from "./api/system.routes.js";
import { registerClient } from "./realtime/ws.js";
import { getPendingDigestEvents } from "./webhooks/events-service.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(fastifyWebsocket);

  app.register(async (instance) => {
    instance.get("/api/ws", { websocket: true }, (socket) => {
      registerClient(socket);
      // Newest first, matching how new "event" broadcasts get prepended —
      // and only what's still pending, since already-digested items would
      // just pile up as noise in a feed meant to show what's coming next.
      const backlog = getPendingDigestEvents().slice().reverse();
      socket.send(JSON.stringify({ type: "backlog", events: backlog }));
    });
  });

  await app.register(webhookRoutes);
  await app.register(settingsRoutes);
  await app.register(eventsRoutes);
  await app.register(systemRoutes);

  // wildcard defaults to true: it serves files via live per-request lookups
  // rather than pre-globbing the directory once at startup, so a rebuild
  // (new content-hashed filenames) is picked up immediately without needing
  // to restart the server process.
  const webDist = process.env.WEB_DIST ?? path.join(process.cwd(), "..", "web", "dist");
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.method === "GET" && !req.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not found" });
  });

  return app;
}
