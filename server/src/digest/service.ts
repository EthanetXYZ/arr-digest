import { desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { digestRuns } from "../db/schema.js";
import { getSettings, type Settings } from "../config/settings.js";
import {
  getMaxEventId,
  getPendingDigestEvents,
  markEventsDigested,
} from "../webhooks/events-service.js";
import { buildDigestMessages, type DigestEvent, type DiscordMessage } from "./builder.js";
import { sendDiscordMessages } from "./discord.js";
import { getSampleEvents } from "./sample-data.js";
import {
  advanceWatermark,
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

// An item leaves the queue once every enabled digest destination that wants
// it has handled it (watermark past its id). Items no digest destination
// wants — filtered out everywhere, or instant-only — are done immediately.
function completedEvents(pending: DigestEvent[]): number[] {
  const digestDests = listDestinations().filter((d) => d.enabled && d.mode === "digest");
  return pending
    .filter((e) => !digestDests.some((d) => d.watermark < e.id && eventMatchesDestination(e, d)))
    .map((e) => e.id);
}

// Sends each destination (all digest destinations, or just `onlyIds` for a
// scheduled run) the queued items it hasn't had yet. A destination's
// watermark only advances when its send succeeds, so a failure is retried
// for that destination alone on its next run — channels that worked never
// get duplicates. Resolves with a warning when some destinations failed;
// throws when every attempted send failed.
export async function runDigest(onlyIds?: number[]): Promise<{ warning?: string }> {
  const settings = getSettings();
  const pending = getPendingDigestEvents() as unknown as DigestEvent[];
  // Snapshot: events arriving mid-run belong to the next run.
  const upTo = getMaxEventId();
  const enabled = listDestinations().filter((d) => d.enabled);
  // Instant destinations get their events as they arrive, not here.
  const targets = enabled.filter(
    (d) => d.mode === "digest" && (onlyIds === undefined || onlyIds.includes(d.id)),
  );
  const ranAt = Date.now();

  if (pending.length === 0 && settings.skipIfEmpty) {
    const destinationName = targets.map((d) => d.name).join(", ") || null;
    db.insert(digestRuns).values({ ranAt, eventCount: 0, status: "skipped_empty", destinationName }).run();
    return {};
  }

  if (enabled.length === 0) {
    const error = "No enabled Discord destinations configured";
    db.insert(digestRuns).values({ ranAt, eventCount: pending.length, status: "error", error }).run();
    broadcast({ type: "digest_error", error, ranAt });
    throw new Error(error);
  }

  const failures: string[] = [];
  const delivered = new Set<number>();
  let attempted = 0;

  for (const dest of targets) {
    const mine = pending.filter(
      (e) => e.id > dest.watermark && e.id <= upTo && eventMatchesDestination(e, dest),
    );
    if (mine.length === 0 && settings.skipIfEmpty) {
      advanceWatermark(dest.id, upTo);
      continue;
    }

    const destSettings = settingsFor(dest);
    const messages = mine.length > 0 ? buildDigestMessages(mine, destSettings) : [emptyDigestMessage(destSettings)];
    attempted++;
    try {
      await sendDiscordMessages(dest.webhookUrl, messages);
      advanceWatermark(dest.id, upTo);
      for (const e of mine) delivered.add(e.id);
      db.insert(digestRuns)
        .values({ ranAt, eventCount: mine.length, status: "sent", destinationName: dest.name })
        .run();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push(`${dest.name}: ${reason}`);
      db.insert(digestRuns)
        .values({
          ranAt,
          eventCount: mine.length,
          status: "error",
          error: `${reason} — will retry on its next run`,
          destinationName: dest.name,
        })
        .run();
    }
  }

  if (attempted === 0) {
    const destinationName = targets.map((d) => d.name).join(", ") || null;
    db.insert(digestRuns).values({ ranAt, eventCount: 0, status: "skipped_empty", destinationName }).run();
  }

  const done = completedEvents(pending.filter((e) => e.id <= upTo));
  markEventsDigested(done);
  // digest_sent before digest_error: clients keep the last-arriving status
  // for a given ranAt, and the failure is what needs to stay visible.
  if (delivered.size > 0 || done.length > 0) {
    broadcast({ type: "digest_sent", eventCount: delivered.size, ranAt, eventIds: done });
  }

  if (failures.length === 0) return {};
  const error = `Failed to send to ${failures.join("; ")} — will retry on its next run`;
  broadcast({ type: "digest_error", error, ranAt });
  if (failures.length === attempted) throw new Error(error);
  return { warning: error };
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
