import { and, eq, lt } from "drizzle-orm";
import { Cron } from "croner";
import { db } from "./db/client.js";
import { mediaEvents } from "./db/schema.js";

const RETENTION_DAYS = 90;

// Once an event has been included in a sent digest it's just historical —
// nothing reads it again — so old ones are pruned to keep the table from
// growing forever. 90 days is generous for anything anyone would plausibly
// want to look back at in the live feed / history.
export function pruneDigestedEvents(): number {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const result = db
    .delete(mediaEvents)
    .where(and(eq(mediaEvents.digested, true), lt(mediaEvents.digestedAt, cutoff)))
    .run();
  return result.changes;
}

function runAndLogPrune() {
  const deleted = pruneDigestedEvents();
  if (deleted > 0) {
    console.log(`[maintenance] pruned ${deleted} digested event(s) older than ${RETENTION_DAYS} days`);
  }
}

export function scheduleMaintenance() {
  runAndLogPrune();
  new Cron("0 3 * * *", runAndLogPrune);
}
