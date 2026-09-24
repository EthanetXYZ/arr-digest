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

  it("on partial failure, marks items sent (no duplicates to working channels) and reports the broken one", async () => {
    dest("good", discord.url("good"));
    dest("broken", UNREACHABLE_URL);
    event({});

    const result = await runDigest();
    assert.match(result.warning ?? "", /broken/);
    assert.equal(discord.to("good").length, 1);
    assert.equal(getPendingDigestEvents().length, 0);
    assert.equal(lastRun()?.status, "error");
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
