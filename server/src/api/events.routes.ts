import type { FastifyInstance } from "fastify";
import { getPendingDigestEvents, getRecentEvents } from "../webhooks/events-service.js";
import {
  getDigestHistory,
  renderPreview,
  runDigest,
  sendTestDigest,
  type PreviewOverrides,
} from "../digest/service.js";

export async function eventsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>("/api/events/recent", async (req) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    return getRecentEvents(limit);
  });

  app.get("/api/events/pending", async () => {
    return getPendingDigestEvents();
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

  // Renders what a digest would look like without touching stored events —
  // used for the live preview in Settings (draft, unsaved settings) and can
  // optionally render sample data instead of the real pending queue.
  app.post<{ Body: { settings?: PreviewOverrides; sample?: boolean } }>(
    "/api/digest/render",
    async (req) => {
      const { settings, sample } = req.body ?? {};
      return renderPreview(settings ?? {}, sample ?? true);
    },
  );

  // Sends one real Discord message built from fixed sample data, so the user
  // can see an actual rendered message in their channel. Never touches the
  // real event queue or digest history.
  app.post<{ Body: { settings?: PreviewOverrides } }>(
    "/api/digest/send-test",
    async (req, reply) => {
      try {
        await sendTestDigest(req.body?.settings ?? {});
        return { ok: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ ok: false, error });
      }
    },
  );
}
