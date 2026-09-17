import { desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { digestRuns } from "../db/schema.js";
import { getSettings, type Settings } from "../config/settings.js";
import {
  getPendingDigestEvents,
  markEventsDigested,
} from "../webhooks/events-service.js";
import { buildDigestMessages, type DigestEvent, type DiscordMessage } from "./builder.js";
import { sendDiscordMessages } from "./discord.js";
import { getSampleEvents } from "./sample-data.js";
import { broadcast } from "../realtime/ws.js";

// Only the fields that affect how a message is rendered — a live preview
// applies these over the saved settings without persisting them, so it can
// reflect edits the user hasn't hit Save on yet.
export interface PreviewOverrides {
  digestTitle?: string;
  groupByType?: boolean;
  showPoster?: boolean;
  compactMode?: boolean;
  mentionContent?: string | null;
}

export function renderPreview(
  overrides: PreviewOverrides,
  useSample: boolean,
): { events: DigestEvent[]; messages: DiscordMessage[] } {
  const settings: Settings = { ...getSettings(), ...overrides };
  const events = useSample
    ? getSampleEvents()
    : (getPendingDigestEvents() as unknown as DigestEvent[]);
  return { events, messages: buildDigestMessages(events, settings) };
}

export async function sendTestDigest(overrides: PreviewOverrides): Promise<void> {
  const settings: Settings = { ...getSettings(), ...overrides };
  if (!settings.discordWebhookUrl) {
    throw new Error("No Discord webhook URL configured");
  }
  const messages = buildDigestMessages(getSampleEvents(), settings);
  await sendDiscordMessages(settings.discordWebhookUrl, messages);
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
    const eventIds = events.map((e) => e.id);
    markEventsDigested(eventIds);
    db.insert(digestRuns)
      .values({ ranAt, eventCount: events.length, status: "sent" })
      .run();
    broadcast({ type: "digest_sent", eventCount: events.length, ranAt, eventIds });
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
