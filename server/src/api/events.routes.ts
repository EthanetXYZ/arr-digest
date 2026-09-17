import type { FastifyInstance } from "fastify";
import { getPendingDigestEvents, getRecentEvents } from "../webhooks/events-service.js";
import { getDigestHistory, previewDigest, runDigest } from "../digest/service.js";

export async function eventsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>("/api/events/recent", async (req) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    return getRecentEvents(limit);
  });

  app.get("/api/events/pending", async () => {
    return getPendingDigestEvents();
  });

  app.get("/api/digest/preview", async () => {
    return previewDigest();
  });

  app.get("/api/digest/history", async () => {
    return getDigestHistory();
  });

  app.post("/api/digest/run-now", async (_req, reply) => {
    try {
      await runDigest();
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ ok: false, error });
    }
  });
}
