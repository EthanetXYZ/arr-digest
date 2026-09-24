import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeRadarrEvent, normalizeSonarrEvent } from "./normalize.js";
import type { RadarrWebhookPayload, SonarrWebhookPayload } from "./types.js";

const series = { id: 1, title: "Show", year: 2020, tvdbId: 11 };
const episodes = [{ id: 1, episodeNumber: 3, seasonNumber: 2, title: "Ep" }];
const movie = { id: 1, title: "Film", year: 2021, tmdbId: 22 };

const sonarr = (p: Partial<SonarrWebhookPayload>) =>
  normalizeSonarrEvent({ eventType: "Download", ...p } as SonarrWebhookPayload);
const radarr = (p: Partial<RadarrWebhookPayload>) =>
  normalizeRadarrEvent({ eventType: "Download", ...p } as RadarrWebhookPayload);

describe("normalizeSonarrEvent", () => {
  it("treats a non-upgrade import as an addition", () => {
    const e = sonarr({ series, episodes, episodeFile: { id: 1, quality: "WEBDL-1080p" }, isUpgrade: false });
    assert.equal(e?.kind, "addition");
    assert.equal(e?.seasonNumber, 2);
    assert.equal(e?.episodeNumber, 3);
    assert.equal(e?.quality, "WEBDL-1080p");
  });

  it("treats an upgrade import as an upgrade, taking the old quality from deletedFiles", () => {
    const e = sonarr({
      series,
      episodes,
      episodeFile: { id: 2, quality: "Bluray-2160p" },
      isUpgrade: true,
      deletedFiles: [{ id: 1, quality: "WEBDL-1080p" }],
    });
    assert.equal(e?.kind, "upgrade");
    assert.equal(e?.previousQuality, "WEBDL-1080p");
    assert.equal(e?.quality, "Bluray-2160p");
  });

  // Sonarr/Radarr serialize deleteReason camelCase ("upgrade"). Comparing
  // against "Upgrade" only once let every upgrade show as a removal.
  for (const reason of ["upgrade", "Upgrade"]) {
    it(`suppresses a delete caused by an upgrade (deleteReason "${reason}")`, () => {
      const e = sonarr({ eventType: "EpisodeFileDelete", series, episodes, deleteReason: reason });
      assert.equal(e, null);
    });
  }

  for (const reason of ["manual", "missingFromDisk"]) {
    it(`reports a genuine delete as a removal (deleteReason "${reason}")`, () => {
      const e = sonarr({
        eventType: "EpisodeFileDelete",
        series,
        episodes,
        episodeFile: { id: 1, quality: "WEBDL-720p" },
        deleteReason: reason,
      });
      assert.equal(e?.kind, "removal");
      assert.equal(e?.quality, "WEBDL-720p");
    });
  }

  it("ignores event types the digest doesn't report", () => {
    for (const eventType of ["Grab", "Rename", "Health", "SeriesAdd"] as const) {
      assert.equal(sonarr({ eventType, series, episodes }), null, eventType);
    }
  });

  it("prefers the poster's public remoteUrl, which Discord can actually fetch", () => {
    const e = sonarr({
      series: {
        ...series,
        images: [
          { coverType: "fanart", remoteUrl: "https://img/fanart.jpg" },
          { coverType: "poster", url: "/MediaCover/1/poster.jpg", remoteUrl: "https://img/poster.jpg" },
        ],
      },
      episodes,
      episodeFile: { id: 1, quality: "HDTV-720p" },
    });
    assert.equal(e?.posterUrl, "https://img/poster.jpg");
  });
});

describe("normalizeRadarrEvent", () => {
  it("maps imports to addition / upgrade", () => {
    assert.equal(radarr({ movie, movieFile: { id: 1, quality: "Bluray-1080p" }, isUpgrade: false })?.kind, "addition");
    const up = radarr({
      movie,
      movieFile: { id: 2, quality: "Bluray-2160p" },
      isUpgrade: true,
      deletedFiles: [{ id: 1, quality: "Bluray-1080p" }],
    });
    assert.equal(up?.kind, "upgrade");
    assert.equal(up?.previousQuality, "Bluray-1080p");
  });

  it("suppresses upgrade deletes but reports genuine ones", () => {
    assert.equal(radarr({ eventType: "MovieFileDelete", movie, deleteReason: "upgrade" }), null);
    const removal = radarr({
      eventType: "MovieFileDelete",
      movie,
      movieFile: { id: 1, quality: "WEBDL-720p" },
      deleteReason: "manual",
    });
    assert.equal(removal?.kind, "removal");
    assert.equal(removal?.mediaType, "movie");
  });
});
