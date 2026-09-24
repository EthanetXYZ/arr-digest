import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDigestMessages, countDisplayUnits, renderTitle, type DigestEvent } from "./builder.js";
import type { Settings } from "../config/settings.js";

const settings: Settings = {
  id: 1,
  discordWebhookUrl: null,
  timezone: "UTC",
  digestTimes: '["09:00"]',
  digestEnabled: true,
  digestTitle: "Library Digest",
  groupByType: true,
  showPoster: true,
  compactMode: true,
  skipIfEmpty: true,
  mentionContent: null,
  webhookToken: "t",
  publicUrl: null,
};

let nextId = 1;
function ev(p: Partial<DigestEvent>): DigestEvent {
  return {
    id: nextId++,
    source: "sonarr",
    kind: "addition",
    mediaType: "series",
    title: "Show",
    year: 2020,
    seasonNumber: 1,
    episodeNumber: 1,
    episodeTitle: "Ep",
    quality: "WEBDL-1080p",
    previousQuality: null,
    posterUrl: null,
    ...p,
  };
}

const descriptions = (s: Settings, events: DigestEvent[]) =>
  buildDigestMessages(events, s).flatMap((m) => m.embeds.map((e) => e.description ?? ""));

describe("buildDigestMessages", () => {
  it("returns nothing for no events", () => {
    assert.deepEqual(buildDigestMessages([], settings), []);
  });

  it("collapses a season batch into one line with an episode range", () => {
    const events = [3, 1, 2].map((n) => ev({ episodeNumber: n }));
    const [desc] = descriptions(settings, events);
    assert.match(desc, /S01E01–E03 \(3 episodes\)/);
    assert.equal(desc.split("\n").length, 1);
  });

  it("never merges different kinds for the same season", () => {
    const events = [
      ev({ episodeNumber: 1, kind: "addition" }),
      ev({ episodeNumber: 2, kind: "addition" }),
      ev({ episodeNumber: 3, kind: "upgrade", previousQuality: "HDTV-720p" }),
    ];
    const messages = buildDigestMessages(events, settings);
    const titles = messages.flatMap((m) => m.embeds.map((e) => e.title));
    // Two added episodes of one season are one line, so one item.
    assert.deepEqual(titles, ["Added — TV Shows (1)", "Upgraded — TV Shows (1)"]);
  });

  it("counts a season batch as one item, in headers and in countDisplayUnits", () => {
    const events = [
      ...[1, 2, 3, 4, 5, 6].map((n) => ev({ episodeNumber: n })),
      ev({ title: "Other Show", episodeNumber: 1 }),
      ev({ seasonNumber: 2, episodeNumber: 1 }),
    ];
    const titles = buildDigestMessages(events, settings).flatMap((m) => m.embeds.map((e) => e.title));
    // S01 batch + Other Show + the lone S02 episode: three lines.
    assert.deepEqual(titles, ["Added — TV Shows (3)"]);
    assert.equal(countDisplayUnits(events), 3);

    const movies = [1, 2].map((id) => ev({ id, mediaType: "movie", title: `Movie ${id}`, seasonNumber: null, episodeNumber: null }));
    assert.equal(countDisplayUnits(movies), 2, "movies are never grouped");
  });

  it("fills title variables from the events in the message", () => {
    const events = [
      ...[1, 2, 3].map((n) => ev({ episodeNumber: n })), // one batch
      ev({ title: "Other", episodeNumber: 1, kind: "upgrade", previousQuality: "HDTV-720p" }),
      ev({ mediaType: "movie", title: "Film", seasonNumber: null, episodeNumber: null }),
      ev({ mediaType: "movie", title: "Gone", seasonNumber: null, episodeNumber: null, kind: "removal" }),
    ];
    assert.equal(renderTitle("{count} new", events), "4 new");
    assert.equal(renderTitle("{added:item} were added", events), "2 items were added");
    assert.equal(renderTitle("{upgraded:item}, {removed:item}", events), "1 item, 1 item");
    assert.equal(renderTitle("{shows} shows, {episodes} eps, {movies} films", events), "2 shows, 4 eps, 2 films");
    assert.equal(renderTitle("{count:entry|entries}", events), "4 entries");
    assert.equal(renderTitle("{removed:entry|entries}", events), "1 entry");
    // Unknown names and stray braces are left alone.
    assert.equal(renderTitle("{nope} {count", events), "{nope} {count");
    assert.equal(renderTitle("Library Digest", events), "Library Digest");
    assert.equal(renderTitle("{added:item}", []), "0 items");
  });

  it("puts the rendered title in the message header", () => {
    const titled = { ...settings, digestTitle: "{added:item} added" };
    const events = [1, 2].map((n) => ev({ episodeNumber: n }));
    assert.equal(buildDigestMessages(events, titled)[0].content, "**1 item added**");
  });

  it("keeps a lone episode on its own line, with its title", () => {
    const [desc] = descriptions(settings, [ev({ episodeNumber: 5, episodeTitle: "Pilot" })]);
    assert.match(desc, /S01E05 — "Pilot"/);
  });

  it("shows quality for a batch only when every episode agrees", () => {
    const same = descriptions(settings, [ev({ episodeNumber: 1 }), ev({ episodeNumber: 2 })])[0];
    assert.match(same, /`WEBDL-1080p`/);
    const mixed = descriptions(settings, [
      ev({ episodeNumber: 1, quality: "WEBDL-1080p" }),
      ev({ episodeNumber: 2, quality: "HDTV-720p" }),
    ])[0];
    assert.doesNotMatch(mixed, /`/);
  });

  it("does not group movies", () => {
    const events = [
      ev({ mediaType: "movie", title: "A", seasonNumber: null, episodeNumber: null }),
      ev({ mediaType: "movie", title: "B", seasonNumber: null, episodeNumber: null }),
    ];
    const [desc] = descriptions(settings, events);
    assert.equal(desc.split("\n").length, 2);
  });

  it("splits into multiple messages to respect Discord's 10-embed limit", () => {
    const detailed = { ...settings, compactMode: false };
    const events = Array.from({ length: 12 }, (_, i) =>
      ev({ mediaType: "movie", title: `Movie ${i}`, seasonNumber: null, episodeNumber: null }),
    );
    const messages = buildDigestMessages(events, detailed);
    assert.deepEqual(messages.map((m) => m.embeds.length), [10, 2]);
    // Only the first message carries the header.
    assert.equal(messages[0].content, "**Library Digest**");
    assert.equal(messages[1].content, undefined);
  });

  it("puts the mention before the title, and drops the title when blank (instant pushes)", () => {
    const withMention = { ...settings, mentionContent: "<@&1>" };
    assert.equal(buildDigestMessages([ev({})], withMention)[0].content, "<@&1> **Library Digest**");
    assert.equal(buildDigestMessages([ev({})], { ...withMention, digestTitle: "" })[0].content, "<@&1>");
  });
});
