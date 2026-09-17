import type { FastifyInstance } from "fastify";
import { getSettings, updateSettings, type SettingsUpdate } from "../config/settings.js";
import { rescheduleDigest } from "../digest/scheduler.js";

interface SettingsPatchBody {
  discordWebhookUrl?: string | null;
  timezone?: string;
  digestTimes?: string[];
  digestEnabled?: boolean;
  digestTitle?: string;
  groupByType?: boolean;
  showPoster?: boolean;
  compactMode?: boolean;
  skipIfEmpty?: boolean;
  mentionContent?: string | null;
  publicUrl?: string | null;
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/api/settings", async () => {
    const settings = getSettings();
    return {
      ...settings,
      digestTimes: JSON.parse(settings.digestTimes),
    };
  });

  app.put<{ Body: SettingsPatchBody }>("/api/settings", async (req, reply) => {
    const body = req.body ?? {};
    const patch: Record<string, unknown> = { ...body };

    if (Array.isArray(body.digestTimes)) {
      const valid = body.digestTimes.every((t) => /^\d{2}:\d{2}$/.test(t));
      if (!valid) {
        return reply.code(400).send({ error: "digestTimes must be HH:mm strings" });
      }
      patch.digestTimes = JSON.stringify(body.digestTimes);
    }

    const updated = updateSettings(patch as SettingsUpdate);
    rescheduleDigest();

    return { ...updated, digestTimes: JSON.parse(updated.digestTimes) };
  });
}
