import type { FastifyInstance } from "fastify";
import { getSettings } from "../config/settings.js";
import { normalizeRadarrEvent, normalizeSonarrEvent } from "./normalize.js";
import type { RadarrWebhookPayload, SonarrWebhookPayload } from "./types.js";
import { recordEvent } from "./events-service.js";

function checkToken(token: unknown): boolean {
  const expected = getSettings().webhookToken;
  return typeof token === "string" && token === expected;
}

export async function webhookRoutes(app: FastifyInstance) {
  app.post<{ Body: SonarrWebhookPayload; Querystring: { token?: string } }>(
    "/api/webhooks/sonarr",
    async (req, reply) => {
      if (!checkToken(req.query.token)) {
        return reply.code(401).send({ error: "invalid webhook token" });
      }

      const payload = req.body;
      if (payload.eventType === "Test") {
        return reply.code(200).send({ ok: true });
      }

      const normalized = normalizeSonarrEvent(payload);
      if (normalized) recordEvent(normalized);

      return reply.code(200).send({ ok: true });
    },
  );

  app.post<{ Body: RadarrWebhookPayload; Querystring: { token?: string } }>(
    "/api/webhooks/radarr",
    async (req, reply) => {
      if (!checkToken(req.query.token)) {
        return reply.code(401).send({ error: "invalid webhook token" });
      }

      const payload = req.body;
      if (payload.eventType === "Test") {
        return reply.code(200).send({ ok: true });
      }

      const normalized = normalizeRadarrEvent(payload);
      if (normalized) recordEvent(normalized);

      return reply.code(200).send({ ok: true });
    },
  );
}
