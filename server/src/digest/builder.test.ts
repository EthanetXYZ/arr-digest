import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDigestMessages, type DigestEvent } from "./builder.js";
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
    assert.deepEqual(titles, ["Added — TV Shows (2)", "Upgraded — TV Shows (1)"]);
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
