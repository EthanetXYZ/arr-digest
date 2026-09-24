// Must stay the first import: points DATA_DIR at a temp dir before
// db/client.ts opens the database.
import "../test/env.js";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sqlite } from "../db/client.js";
import { bootstrapDb } from "../db/bootstrap.js";
import { getPendingDigestEvents, recordEvent, removePendingEvent } from "../webhooks/events-service.js";
import type { NormalizedEvent } from "../webhooks/normalize.js";
import {
  createDestination,
  deleteDestination,
  listDestinations,
  scheduleByTime,
  updateDestination,
  validateDestination,
  type DestinationInput,
} from "./destinations.js";
import { runDigest } from "./service.js";
import { instantTiming, queueInstant } from "./instant.js";
import { startMockDiscord, UNREACHABLE_URL } from "../test/mock-discord.js";

let discord: Awaited<ReturnType<typeof startMockDiscord>>;

before(async () => {
  bootstrapDb();
  discord = await startMockDiscord();
});

after(() => discord.close());

beforeEach(() => {
  sqlite.exec("DELETE FROM destinations; DELETE FROM media_events; DELETE FROM digest_runs;");
  sqlite.exec("UPDATE settings SET skip_if_empty = 1, discord_webhook_url = NULL, mention_content = NULL");
  discord.received.length = 0;
});

function dest(name: string, url: string, p: Partial<DestinationInput> = {}) {
  return createDestination({
    name,
    webhookUrl: url,
    enabled: true,
    mode: "digest",
    includeAdditions: true,
    includeUpgrades: true,
    includeRemovals: true,
    includeMovies: true,
    includeSeries: true,
    mentionContent: null,
    digestTimes: null,
    ...p,
  });
}

function event(p: Partial<NormalizedEvent>) {
  return recordEvent({
    source: "radarr",
    kind: "addition",
    mediaType: "movie",
    title: "Film",
    year: 2020,
    seasonNumber: null,
    episodeNumber: null,
    episodeTitle: null,
    quality: "Bluray-1080p",
    previousQuality: null,
    posterUrl: null,
    externalIds: {},
    occurredAt: Date.now(),
    ...p,
  });
}

function inputOf(d: ReturnType<typeof dest>): DestinationInput {
  const { id: _id, createdAt: _c, watermark: _w, digestTimes, ...rest } = d;
  return { ...rest, mode: rest.mode as DestinationInput["mode"], digestTimes: digestTimes ? JSON.parse(digestTimes) : null };
}

// What a real webhook does: store the event, then hand it to instant delivery.
function arrive(p: Partial<NormalizedEvent>) {
  const row = event(p);
  queueInstant(row);
  return row;
}

const lastRun = () =>
  sqlite.prepare("SELECT status, error FROM digest_runs ORDER BY id DESC LIMIT 1").get() as
    | { status: string; error: string | null }
    | undefined;

const allText = (path: string) =>
  discord
    .to(path)
    .flatMap((r) => r.body.embeds.map((e) => `${e.title} ${e.description}`))
    .join("\n");

describe("legacy webhook migration", () => {
  it("turns the old single webhook into a catch-all 'Main' destination exactly once", () => {
    sqlite.exec("UPDATE settings SET discord_webhook_url = 'https://discord.example/wh', mention_content = '@here'");
    bootstrapDb();
    bootstrapDb();
    const all = listDestinations();
    assert.equal(all.length, 1);
    assert.equal(all[0].name, "Main");
    assert.equal(all[0].mentionContent, "@here");
    assert.equal(all[0].mode, "digest");

    // Deleting Main must not bring it back on the next startup.
    deleteDestination(all[0].id);
    bootstrapDb();
    assert.equal(listDestinations().length, 0);
  });
});

describe("scheduled digest", () => {
  it("sends each destination only the kinds and media it subscribes to", async () => {
    dest("adds", discord.url("adds"), { includeUpgrades: false, includeRemovals: false });
    dest("removals-tv", discord.url("removals-tv"), {
      includeAdditions: false,
      includeUpgrades: false,
      includeMovies: false,
    });
    dest("off", discord.url("off"), { enabled: false });

    event({ kind: "addition", title: "New Film" });
    event({ kind: "removal", title: "Gone Film" });
    event({ kind: "removal", mediaType: "series", title: "Gone Show", seasonNumber: 1, episodeNumber: 1 });

    assert.deepEqual(await runDigest(), {});
    assert.match(allText("adds"), /New Film/);
    assert.doesNotMatch(allText("adds"), /Gone/);
    assert.match(allText("removals-tv"), /Gone Show/);
    assert.doesNotMatch(allText("removals-tv"), /Film/);
    assert.equal(discord.to("off").length, 0);
    assert.equal(getPendingDigestEvents().length, 0);
    assert.equal(lastRun()?.status, "sent");
  });

  it("uses each destination's own mention", async () => {
    dest("pinged", discord.url("pinged"), { mentionContent: "<@&42>" });
    event({});
    await runDigest();
    assert.equal(discord.to("pinged")[0].body.content, "<@&42> **Library Digest**");
  });

  it("on partial failure, retries only the broken destination — the working one gets no duplicates", async () => {
    dest("good", discord.url("good"));
    const broken = dest("broken", UNREACHABLE_URL);
    event({});

    const first = await runDigest();
    assert.match(first.warning ?? "", /broken/);
    assert.equal(discord.to("good").length, 1);
    // Still queued: "broken" hasn't received it yet.
    assert.equal(getPendingDigestEvents().length, 1);

    // "good" has nothing new, so the only send attempted is the retry — which
    // fails again, so this run as a whole failed.
    await assert.rejects(runDigest(), /broken/);
    assert.equal(discord.to("good").length, 1, "no duplicate to the working channel");

    // Fixing (here: disabling) the broken destination releases the item.
    updateDestination(broken.id, { ...inputOf(broken), enabled: false });
    await runDigest();
    assert.equal(getPendingDigestEvents().length, 0);
    assert.equal(discord.to("good").length, 1);
  });

  it("gives each run its own history row per destination", async () => {
    dest("good", discord.url("good"));
    dest("broken", UNREACHABLE_URL);
    event({});
    await runDigest();
    const rows = sqlite
      .prepare("SELECT status, destination_name AS name FROM digest_runs ORDER BY id")
      .all() as { status: string; name: string }[];
    assert.deepEqual(rows, [
      { status: "sent", name: "good" },
      { status: "error", name: "broken" },
    ]);
  });

  it("on total failure, keeps items queued so the next run retries them", async () => {
    dest("broken", UNREACHABLE_URL);
    event({});
    await assert.rejects(runDigest(), /broken/);
    assert.equal(getPendingDigestEvents().length, 1);
  });

  it("errors when there are no enabled destinations at all", async () => {
    dest("off", discord.url("off"), { enabled: false });
    event({});
    await assert.rejects(runDigest(), /No enabled Discord destinations/);
    assert.equal(getPendingDigestEvents().length, 1);
  });

  it("skips quietly when there's nothing to send", async () => {
    dest("d", discord.url("d"));
    await runDigest();
    assert.equal(discord.received.length, 0);
    assert.equal(lastRun()?.status, "skipped_empty");
  });

  it("ignores instant destinations, and with only instant ones clears the queue without an error", async () => {
    dest("instant", discord.url("instant"), { mode: "instant" });
    event({});
    await runDigest();
    assert.equal(discord.to("instant").length, 0);
    assert.equal(getPendingDigestEvents().length, 0);
    assert.equal(lastRun()?.status, "skipped_empty");
  });
});

describe("per-destination schedules", () => {
  it("sends each destination its items on its own run, once, and releases them after the last", async () => {
    const morning = dest("morning", discord.url("morning"), { digestTimes: ["09:00"] });
    const evening = dest("evening", discord.url("evening"));
    const e = event({ title: "Split Film" });

    await runDigest([morning.id]);
    assert.equal(discord.to("morning").length, 1);
    assert.equal(discord.to("evening").length, 0);
    assert.ok(getPendingDigestEvents().some((p) => p.id === e.id), "evening still needs it");

    await runDigest([morning.id]);
    assert.equal(discord.to("morning").length, 1, "no repeat for morning");

    await runDigest([evening.id]);
    assert.match(allText("evening"), /Split Film/);
    assert.equal(getPendingDigestEvents().length, 0);
  });

  it("groups destinations into one job per time, main-schedule destinations at every main time", () => {
    const main = dest("main", discord.url("x"));
    const custom = dest("custom", discord.url("x"), { digestTimes: ["07:30", "20:00"] });
    dest("disabled", discord.url("x"), { enabled: false, digestTimes: ["06:00"] });
    dest("instant", discord.url("x"), { mode: "instant", digestTimes: ["05:00"] });

    const byTime = scheduleByTime(listDestinations(), ["09:00", "20:00"]);
    assert.deepEqual(Object.fromEntries(byTime), {
      "09:00": [main.id],
      "20:00": [main.id, custom.id],
      "07:30": [custom.id],
    });
  });

  it("keeps main times scheduled even with no destinations on them", () => {
    dest("custom", discord.url("x"), { digestTimes: ["07:30"] });
    assert.deepEqual(scheduleByTime(listDestinations(), ["09:00"]).get("09:00"), []);
  });

  it("rejects an empty or malformed custom schedule", () => {
    const base = inputOf(dest("x", discord.url("x")));
    assert.match(validateDestination({ ...base, digestTimes: [] }) ?? "", /at least one/);
    assert.match(validateDestination({ ...base, digestTimes: ["9am"] }) ?? "", /HH:mm/);
    assert.match(validateDestination({ ...base, digestTimes: ["24:00"] }) ?? "", /HH:mm/);
    assert.equal(validateDestination({ ...base, digestTimes: ["23:59"] }), null);
  });

  it("gives a new destination what's currently queued, but none of the already-sent history", async () => {
    dest("old", discord.url("old"));
    event({ title: "Already Sent" });
    await runDigest();
    event({ title: "Still Queued" });
    // "old" hasn't run since, so "Still Queued" is pending.
    const fresh = dest("fresh", discord.url("fresh"));
    await runDigest([fresh.id]);
    assert.match(allText("fresh"), /Still Queued/);
    assert.doesNotMatch(allText("fresh"), /Already Sent/);
  });

  it("upgrading an existing database starts each destination at the oldest queued item", () => {
    // Recreate the pre-watermark schema: a destination plus one sent and two
    // queued events, then drop the column and re-run the startup migration.
    const d = dest("existing", discord.url("x"));
    const sent = event({ title: "Sent" });
    const queued = event({ title: "Queued" });
    event({ title: "Queued 2" });
    sqlite.prepare("UPDATE media_events SET digested = 1 WHERE id = ?").run(sent.id);
    sqlite.exec("ALTER TABLE destinations DROP COLUMN watermark");

    bootstrapDb();
    const row = sqlite.prepare("SELECT watermark FROM destinations WHERE id = ?").get(d.id) as {
      watermark: number;
    };
    assert.equal(row.watermark, queued.id - 1);
  });
});

describe("instant delivery", () => {
  before(() => {
    instantTiming.quietMs = 40;
    instantTiming.maxWaitMs = 1000;
  });

  const settle = () => new Promise((r) => setTimeout(r, instantTiming.quietMs * 5));

  it("sends a burst as one message per destination, without the digest title", async () => {
    dest("tv", discord.url("tv"), { mode: "instant", includeMovies: false, mentionContent: "@here" });
    for (const n of [1, 2, 3]) {
      arrive({ mediaType: "series", title: "Burst Show", seasonNumber: 1, episodeNumber: n });
    }
    arrive({ title: "A Movie" }); // movies excluded from "tv"

    await discord.waitFor(1);
    await settle();
    const sent = discord.to("tv");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.content, "@here");
    assert.match(allText("tv"), /S01E01–E03 \(3 episodes\)/);
    assert.doesNotMatch(allText("tv"), /A Movie/);
  });

  const instantRemovals = () =>
    dest("instant-removals", discord.url("ir"), {
      mode: "instant",
      includeAdditions: false,
      includeUpgrades: false,
    });

  it("keeps a pushed item queued when a digest destination also wants it", async () => {
    instantRemovals();
    dest("digest-all", discord.url("digest"));
    const row = arrive({ kind: "removal", title: "Gone" });
    await discord.waitFor(1);
    await settle();
    assert.ok(getPendingDigestEvents().some((e) => e.id === row.id));
  });

  it("clears a pushed item only instant destinations want (it won't be in the digest)", async () => {
    instantRemovals();
    dest("digest-additions", discord.url("digest"), { includeUpgrades: false, includeRemovals: false });
    const row = arrive({ kind: "removal", title: "Gone" });
    await discord.waitFor(1);
    await settle();
    assert.ok(!getPendingDigestEvents().some((e) => e.id === row.id));
  });

  it("doesn't send an item removed from the queue during the wait", async () => {
    dest("i", discord.url("i"), { mode: "instant" });
    const row = arrive({ title: "Regretted" });
    assert.ok(removePendingEvent(row.id));
    await settle();
    assert.equal(discord.to("i").length, 0);
  });

  it("reports a failed push and leaves the item visible", async () => {
    dest("broken-instant", UNREACHABLE_URL, { mode: "instant" });
    const row = arrive({ title: "Unlucky" });
    const start = Date.now();
    while (!lastRun() && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 10));
    assert.equal(lastRun()?.status, "error");
    assert.match(lastRun()?.error ?? "", /Instant push to broken-instant failed/);
    assert.ok(getPendingDigestEvents().some((e) => e.id === row.id));
  });
});
