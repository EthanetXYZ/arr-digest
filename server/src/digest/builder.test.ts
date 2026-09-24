import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDigestMessages, countDisplayUnits, renderDigestTitle, renderTitle, type DigestEvent } from "./builder.js";
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

  it("drops zero counts from a list and joins the rest naturally", () => {
    const episodes = [1, 2, 3].map((n) => ev({ episodeNumber: n }));
    const movie = (title: string) => ev({ mediaType: "movie", title, seasonNumber: null, episodeNumber: null });
    const list = "{movies:movie, episodes:episode} were added";

    assert.equal(renderTitle(list, episodes), "3 episodes were added");
    assert.equal(renderTitle(list, [movie("A"), movie("B"), ...episodes]), "2 movies & 3 episodes were added");
    assert.equal(
      renderTitle("{movies:movie, shows:show, episodes:episode}", [movie("A"), ...episodes]),
      "1 movie, 1 show & 3 episodes",
    );
    assert.equal(renderTitle("{movies:movie, episodes:episode}", []), "no movies or episodes");
    assert.equal(renderTitle("{movies:movie, shows:show, episodes:episode}", []), "no movies, shows or episodes");
    assert.equal(renderTitle("{count:entry|entries, movies:film}", episodes), "1 entry");
    // Spacing inside the braces doesn't matter.
    assert.equal(renderTitle("{ movies : movie ,episodes:episode }", episodes), "3 episodes");
    // One bad part leaves the whole thing as typed.
    assert.equal(renderTitle("{movies:movie, nope:x}", episodes), "{movies:movie, nope:x}");
  });

  it("counts only one kind with an added_/upgraded_/removed_ prefix", () => {
    const movie = (kind: string) => ev({ kind, mediaType: "movie", title: kind, seasonNumber: null, episodeNumber: null });
    const events = [
      movie("addition"),
      movie("removal"),
      movie("removal"),
      ...[1, 2].map((n) => ev({ episodeNumber: n })),
      ev({ title: "Other", episodeNumber: 1, kind: "upgrade", previousQuality: "HDTV-720p" }),
    ];
    assert.equal(renderTitle("{movies}", events), "3", "unprefixed counts every kind");
    assert.equal(renderTitle("{added_movies}/{removed_movies}/{upgraded_movies}", events), "1/2/0");
    assert.equal(renderTitle("{added_episodes}/{added_shows}/{upgraded_shows}", events), "2/1/1");
    assert.equal(
      renderTitle("{added_movies:movie, added_episodes:episode} {was|were} added", events),
      "1 movie & 2 episodes were added",
    );
  });

  it("{was|were} agrees with the count before it", () => {
    const movie = (title: string) => ev({ mediaType: "movie", title, seasonNumber: null, episodeNumber: null });
    const one = [movie("A")];
    const two = [movie("A"), movie("B")];
    const oneOfEach = [movie("A"), ev({ episodeNumber: 1 })];

    assert.equal(renderTitle("{added:item} {was|were} added", one), "1 item was added");
    assert.equal(renderTitle("{added:item} {was|were} added", two), "2 items were added");
    assert.equal(renderTitle("{added:item} {was|were} added", []), "0 items were added");
    const list = "{movies:movie, episodes:episode} {was|were} added";
    assert.equal(renderTitle(list, one), "1 movie was added");
    // Two things listed is plural even though each count is one.
    assert.equal(renderTitle(list, oneOfEach), "1 movie & 1 episode were added");
    assert.equal(renderTitle(list, []), "no movies or episodes were added");
    // Follows the nearest count, left to right; plural with none before it.
    assert.equal(
      renderTitle("{was|were}: {movies:movie} {is|are} new, {episodes:episode} {was|were} too", two),
      "were: 2 movies are new, 0 episodes were too",
    );
    assert.equal(renderTitle("{removed:item} {has|have} gone", one.map((e) => ({ ...e, kind: "removal" as const }))), "1 item has gone");
  });

  it("puts the rendered title in the message header", () => {
    const titled = { ...settings, digestTitle: "{added:item} added" };
    const events = [1, 2].map((n) => ev({ episodeNumber: n }));
    assert.equal(buildDigestMessages(events, titled)[0].content, "**1 item added**");
  });

  it("leaves the title off when every count in it is zero, but still sends the content", () => {
    const removals = [ev({ kind: "removal", mediaType: "movie", title: "Gone", seasonNumber: null, episodeNumber: null })];
    const additionsTitle = { ...settings, digestTitle: "{added_movies:movie, added_episodes:episode} {was|were} added" };
    const [msg] = buildDigestMessages(removals, additionsTitle);
    assert.equal(msg.content, undefined, "no header at all");
    assert.equal(msg.embeds[0].title, "Removed — Movies (1)", "the removal still goes out");

    // Same, keeping the mention.
    const withMention = { ...additionsTitle, mentionContent: "@here" };
    assert.equal(buildDigestMessages(removals, withMention)[0].content, "@here");

    // Any non-zero count keeps the whole title, zeros and all.
    const mixed = { ...settings, digestTitle: "{added:item} added, {removed:item} removed" };
    assert.equal(buildDigestMessages(removals, mixed)[0].content, "**0 items added, 1 item removed**");

    // A title with no counts is always shown.
    assert.equal(buildDigestMessages(removals, settings)[0].content, "**Library Digest**");
    assert.equal(renderDigestTitle("{added:item} added", []), "");
    assert.equal(renderDigestTitle("Library Digest", []), "Library Digest");
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
