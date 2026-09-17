import { desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { digestRuns } from "../db/schema.js";
import { getSettings } from "../config/settings.js";
import {
  getPendingDigestEvents,
  markEventsDigested,
} from "../webhooks/events-service.js";
import { buildDigestMessages, type DigestEvent } from "./builder.js";
import { sendDiscordMessages } from "./discord.js";
import { broadcast } from "../realtime/ws.js";

export function previewDigest(): { events: DigestEvent[]; messages: ReturnType<typeof buildDigestMessages> } {
  const settings = getSettings();
  const events = getPendingDigestEvents() as unknown as DigestEvent[];
  return { events, messages: buildDigestMessages(events, settings) };
}

export async function runDigest(): Promise<void> {
  const settings = getSettings();
  const events = getPendingDigestEvents() as unknown as DigestEvent[];
  const ranAt = Date.now();

  if (events.length === 0 && settings.skipIfEmpty) {
    db.insert(digestRuns)
      .values({ ranAt, eventCount: 0, status: "skipped_empty" })
      .run();
    return;
  }

  if (!settings.discordWebhookUrl) {
    const error = "No Discord webhook URL configured";
    db.insert(digestRuns).values({ ranAt, eventCount: events.length, status: "error", error }).run();
    broadcast({ type: "digest_error", error, ranAt });
    throw new Error(error);
  }

  try {
    const messages = buildDigestMessages(events, settings);
    if (messages.length === 0) {
      // events.length === 0 but skipIfEmpty is false — still let the user know.
      const title = settings.digestTitle?.trim();
      const mention = settings.mentionContent?.trim();
      const content = [mention, title ? `**${title}**` : undefined, "No changes since the last digest."]
        .filter(Boolean)
        .join(" ");
      messages.push({ content, embeds: [] });
    }
    await sendDiscordMessages(settings.discordWebhookUrl, messages);
    markEventsDigested(events.map((e) => e.id));
    db.insert(digestRuns)
      .values({ ranAt, eventCount: events.length, status: "sent" })
      .run();
    broadcast({ type: "digest_sent", eventCount: events.length, ranAt });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    db.insert(digestRuns).values({ ranAt, eventCount: events.length, status: "error", error }).run();
    broadcast({ type: "digest_error", error, ranAt });
    throw err;
  }
}

export function getDigestHistory(limit = 20) {
  return db
    .select()
    .from(digestRuns)
    .orderBy(desc(digestRuns.ranAt))
    .limit(limit)
    .all()
    .reverse();
}
