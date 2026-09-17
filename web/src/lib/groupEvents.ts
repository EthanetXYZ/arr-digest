import type { MediaEvent } from "../types";

// Mirrors the server's digest grouping (server/src/digest/builder.ts): events
// for the same show + season + kind collapse into one group. Unlike the
// digest (a fixed batch), the live feed's `events` list changes on every
// WS message, so this runs fresh each time — a group's position tracks its
// newest member, so a batch bubbles to the top as more episodes land.
export function groupLiveEvents(events: MediaEvent[]): MediaEvent[][] {
  const groups = new Map<string, MediaEvent[]>();
  const order: string[] = [];

  for (const e of events) {
    const key =
      e.mediaType === "series" && e.seasonNumber != null
        ? `${e.kind}|${e.title}|${e.year}|${e.seasonNumber}`
        : `single|${e.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(e);
  }

  return order.map((key) => groups.get(key)!);
}
