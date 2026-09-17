import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { mediaEvents } from "../db/schema.js";
import { broadcast } from "../realtime/ws.js";
import type { NormalizedEvent } from "./normalize.js";

export function recordEvent(event: NormalizedEvent) {
  const now = Date.now();
  const inserted = db
    .insert(mediaEvents)
    .values({
      source: event.source,
      kind: event.kind,
      mediaType: event.mediaType,
      title: event.title,
      year: event.year,
      seasonNumber: event.seasonNumber,
      episodeNumber: event.episodeNumber,
      episodeTitle: event.episodeTitle,
      quality: event.quality,
      previousQuality: event.previousQuality,
      posterUrl: event.posterUrl,
      externalIds: JSON.stringify(event.externalIds),
      occurredAt: event.occurredAt,
      digested: false,
      createdAt: now,
    })
    .returning()
    .get();

  broadcast({ type: "event", event: inserted });
  return inserted;
}

export function getRecentEvents(limit = 100) {
  return db
    .select()
    .from(mediaEvents)
    .orderBy(desc(mediaEvents.occurredAt))
    .limit(limit)
    .all();
}

export function getPendingDigestEvents() {
  return db
    .select()
    .from(mediaEvents)
    .where(eq(mediaEvents.digested, false))
    .orderBy(mediaEvents.occurredAt)
    .all();
}

export function markEventsDigested(ids: number[]) {
  if (ids.length === 0) return;
  const now = Date.now();
  for (const id of ids) {
    db
      .update(mediaEvents)
      .set({ digested: true, digestedAt: now })
      .where(eq(mediaEvents.id, id))
      .run();
  }
}
