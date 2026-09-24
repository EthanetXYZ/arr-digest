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
import {
  eventMatchesDestination,
  getDestination,
  listDestinations,
  renderSettingsFor as settingsFor,
  type FormatOverrides,
} from "./destinations.js";
import { broadcast } from "../realtime/ws.js";

// Only the fields that affect how a message is rendered — a live preview
// applies these over the saved settings without persisting them, so it can
// reflect edits the user hasn't hit Save on yet.
export type PreviewOverrides = FormatOverrides;

function emptyDigestMessage(settings: Settings): DiscordMessage {
  const title = settings.digestTitle?.trim();
  const mention = settings.mentionContent?.trim();
  const content = [mention, title ? `**${title}**` : undefined, "No changes since the last digest."]
    .filter(Boolean)
    .join(" ");
  return { content, embeds: [] };
}

export function renderPreview(
  overrides: PreviewOverrides,
  useSample: boolean,
  destinationId?: number,
): { events: DigestEvent[]; messages: DiscordMessage[] } {
  const dest = destinationId != null ? getDestination(destinationId) : undefined;
  const all = useSample ? getSampleEvents() : (getPendingDigestEvents() as unknown as DigestEvent[]);
  const events = dest ? all.filter((e) => eventMatchesDestination(e, dest)) : all;
  return { events, messages: buildDigestMessages(events, settingsFor(dest, overrides)) };
}

export async function sendTestDigest(destinationId: number, overrides: PreviewOverrides): Promise<void> {
  const dest = getDestination(destinationId);
  if (!dest) throw new Error("Destination not found");
  const settings = settingsFor(dest, overrides);
  const events = getSampleEvents().filter((e) => eventMatchesDestination(e, dest));
  const messages = events.length > 0 ? buildDigestMessages(events, settings) : [emptyDigestMessage(settings)];
  await sendDiscordMessages(dest.webhookUrl, messages);
}

// Resolves with a warning when some (but not all) destinations failed —
// the digest still counts as sent in that case. Throws when nothing got out.
export async function runDigest(): Promise<{ warning?: string }> {
  const settings = getSettings();
  const events = getPendingDigestEvents() as unknown as DigestEvent[];
  const enabled = listDestinations().filter((d) => d.enabled);
  // Instant destinations already got their events as they arrived.
  const targets = enabled.filter((d) => d.mode === "digest");
  const ranAt = Date.now();

  if (events.length === 0 && settings.skipIfEmpty) {
    db.insert(digestRuns).values({ ranAt, eventCount: 0, status: "skipped_empty" }).run();
    return {};
  }

  if (enabled.length === 0) {
    const error = "No enabled Discord destinations configured";
    db.insert(digestRuns).values({ ranAt, eventCount: events.length, status: "error", error }).run();
    broadcast({ type: "digest_error", error, ranAt });
    throw new Error(error);
  }

  // Instant-only setup: there's no digest to send. Whatever's still queued
  // matched no destination (or its instant push failed, which was already
  // reported), so clear it rather than logging an error every run.
  if (targets.length === 0) {
    const ids = events.map((e) => e.id);
    markEventsDigested(ids);
    db.insert(digestRuns).values({ ranAt, eventCount: 0, status: "skipped_empty" }).run();
    for (const id of ids) broadcast({ type: "event_removed", id });
    return {};
  }

  let attempted = 0;
  let succeeded = 0;
  const failures: string[] = [];

  for (const dest of targets) {
    const destSettings = settingsFor(dest);
    const routed = events.filter((e) => eventMatchesDestination(e, dest));
    if (routed.length === 0 && settings.skipIfEmpty) continue;

    const messages =
      routed.length > 0 ? buildDigestMessages(routed, destSettings) : [emptyDigestMessage(destSettings)];
    attempted++;
    try {
      await sendDiscordMessages(dest.webhookUrl, messages);
      succeeded++;
    } catch (err) {
      failures.push(`${dest.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Mark events sent as long as at least one destination got its share (or
  // nothing needed sending — e.g. every pending event was routed to a
  // destination filtered out of it). Holding the batch back on a partial
  // failure would re-send duplicates to the working channels every run for
  // as long as one webhook stays broken; the failure still surfaces in the
  // banner so the broken destination gets noticed and fixed.
  const markSent = attempted === 0 || succeeded > 0;
  const eventIds = events.map((e) => e.id);
  if (markSent) markEventsDigested(eventIds);

  if (failures.length > 0) {
    const error = `Failed to send to ${failures.join("; ")}`;
    db.insert(digestRuns).values({ ranAt, eventCount: events.length, status: "error", error }).run();
    // digest_sent before digest_error: clients keep the last-arriving status
    // for a given ranAt, and the failure is what needs to stay visible.
    if (markSent) broadcast({ type: "digest_sent", eventCount: events.length, ranAt, eventIds });
    broadcast({ type: "digest_error", error, ranAt });
    if (!markSent) throw new Error(error);
    return { warning: error };
  }

  db.insert(digestRuns).values({ ranAt, eventCount: events.length, status: "sent" }).run();
  broadcast({ type: "digest_sent", eventCount: events.length, ranAt, eventIds });
  return {};
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
