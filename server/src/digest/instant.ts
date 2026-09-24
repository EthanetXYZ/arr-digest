import { db } from "../db/client.js";
import { digestRuns } from "../db/schema.js";
import { existingEventIds, markEventsDigested } from "../webhooks/events-service.js";
import { broadcast } from "../realtime/ws.js";
import { buildDigestMessages, type DigestEvent } from "./builder.js";
import { sendDiscordMessages } from "./discord.js";
import {
  eventMatchesDestination,
  getDestination,
  listDestinations,
  renderSettingsFor,
} from "./destinations.js";

// A season import arrives as one webhook per episode, seconds apart. Sending
// each immediately would post ten messages for a ten-episode drop, so events
// are held per destination until arrivals go quiet for QUIET_MS (capped at
// MAX_WAIT_MS so a long trickle still goes out), then sent together — which
// lets the builder consolidate them into one "S01E01–E10" line.
// Mutable only so tests can shorten the waits.
export const instantTiming = { quietMs: 20_000, maxWaitMs: 120_000 };

interface Pending {
  events: DigestEvent[];
  firstAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const buffers = new Map<number, Pending>();

export function queueInstant(event: DigestEvent) {
  for (const dest of listDestinations()) {
    if (!dest.enabled || dest.mode !== "instant" || !eventMatchesDestination(event, dest)) continue;

    const existing = buffers.get(dest.id);
    if (existing) clearTimeout(existing.timer);
    const firstAt = existing?.firstAt ?? Date.now();
    const events = [...(existing?.events ?? []), event];
    const delay = Math.min(
      instantTiming.quietMs,
      Math.max(0, firstAt + instantTiming.maxWaitMs - Date.now()),
    );

    buffers.set(dest.id, {
      events,
      firstAt,
      timer: setTimeout(() => void flush(dest.id), delay),
    });
  }
}

// Once pushed, an event no digest destination wants is done: it won't be in
// the next digest, so it leaves the Live Feed (which shows what's queued for
// the digest). Events a digest destination also wants stay queued for it.
function isInstantOnly(event: DigestEvent): boolean {
  return !listDestinations().some(
    (d) => d.enabled && d.mode === "digest" && eventMatchesDestination(event, d),
  );
}

async function flush(destId: number) {
  const pending = buffers.get(destId);
  buffers.delete(destId);
  if (!pending) return;

  // Re-read: the destination may have been edited, disabled or deleted
  // while its events were buffered.
  const dest = getDestination(destId);
  if (!dest || !dest.enabled || dest.mode !== "instant") return;
  // An event the user removed from the queue (✕ in the Live Feed) during the
  // wait shouldn't still go out.
  const stillExists = existingEventIds(pending.events.map((e) => e.id));
  const events = pending.events.filter((e) => stillExists.has(e.id) && eventMatchesDestination(e, dest));
  if (events.length === 0) return;

  try {
    await sendDiscordMessages(dest.webhookUrl, buildDigestMessages(events, renderSettingsFor(dest)));
    const done = events.filter(isInstantOnly).map((e) => e.id);
    if (done.length > 0) {
      markEventsDigested(done);
      for (const id of done) broadcast({ type: "event_removed", id });
    }
  } catch (err) {
    const ranAt = Date.now();
    const error = `Instant push to ${dest.name} failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[instant] ${error}`);
    db.insert(digestRuns).values({ ranAt, eventCount: events.length, status: "error", error }).run();
    broadcast({ type: "digest_error", error, ranAt });
  }
}
