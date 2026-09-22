import type {
  RadarrWebhookPayload,
  SonarrWebhookPayload,
  WebhookImage,
} from "./types.js";

export interface NormalizedEvent {
  source: "sonarr" | "radarr";
  kind: "addition" | "removal" | "upgrade";
  mediaType: "series" | "movie";
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  quality: string | null;
  previousQuality: string | null;
  posterUrl: string | null;
  externalIds: Record<string, string | number>;
  occurredAt: number;
}

// deleteReason is serialized through Sonarr/Radarr's global camelCase enum
// converter ("upgrade"), unlike eventType which has a PascalCase override
// ("Download"). Compare case-insensitively so either form is caught.
function isUpgradeDelete(reason: string | undefined): boolean {
  return reason?.toLowerCase() === "upgrade";
}

function pickPoster(images: WebhookImage[] | undefined): string | null {
  if (!images?.length) return null;
  const poster = images.find((i) => i.coverType === "poster") ?? images[0];
  // remoteUrl points at a publicly reachable image (TheTVDB/TMDB/Fanart),
  // which Discord can actually fetch — the *arr instance itself usually can't.
  return poster.remoteUrl ?? poster.url ?? null;
}

export function normalizeSonarrEvent(
  payload: SonarrWebhookPayload,
): NormalizedEvent | null {
  const now = Date.now();

  if (payload.eventType === "Download" && payload.series) {
    const ep = payload.episodes?.[0];
    const previousQuality = payload.deletedFiles?.[0]?.quality ?? null;
    return {
      source: "sonarr",
      kind: payload.isUpgrade ? "upgrade" : "addition",
      mediaType: "series",
      title: payload.series.title,
      year: payload.series.year ?? null,
      seasonNumber: ep?.seasonNumber ?? null,
      episodeNumber: ep?.episodeNumber ?? null,
      episodeTitle: ep?.title ?? null,
      quality: payload.episodeFile?.quality ?? null,
      previousQuality,
      posterUrl: pickPoster(payload.series.images),
      externalIds: {
        ...(payload.series.tvdbId ? { tvdbId: payload.series.tvdbId } : {}),
        ...(payload.series.imdbId ? { imdbId: payload.series.imdbId } : {}),
      },
      occurredAt: now,
    };
  }

  if (payload.eventType === "EpisodeFileDelete" && payload.series) {
    // Deletes caused by an import upgrade are already represented by the
    // paired Download event (isUpgrade: true) — reporting this too would
    // double-count the same file swap as a spurious "removal".
    if (isUpgradeDelete(payload.deleteReason)) return null;

    const ep = payload.episodes?.[0];
    return {
      source: "sonarr",
      kind: "removal",
      mediaType: "series",
      title: payload.series.title,
      year: payload.series.year ?? null,
      seasonNumber: ep?.seasonNumber ?? null,
      episodeNumber: ep?.episodeNumber ?? null,
      episodeTitle: ep?.title ?? null,
      quality: payload.episodeFile?.quality ?? null,
      previousQuality: null,
      posterUrl: pickPoster(payload.series.images),
      externalIds: {
        ...(payload.series.tvdbId ? { tvdbId: payload.series.tvdbId } : {}),
        ...(payload.series.imdbId ? { imdbId: payload.series.imdbId } : {}),
      },
      occurredAt: now,
    };
  }

  return null;
}

export function normalizeRadarrEvent(
  payload: RadarrWebhookPayload,
): NormalizedEvent | null {
  const now = Date.now();

  if (payload.eventType === "Download" && payload.movie) {
    const previousQuality = payload.deletedFiles?.[0]?.quality ?? null;
    return {
      source: "radarr",
      kind: payload.isUpgrade ? "upgrade" : "addition",
      mediaType: "movie",
      title: payload.movie.title,
      year: payload.movie.year ?? null,
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null,
      quality: payload.movieFile?.quality ?? null,
      previousQuality,
      posterUrl: pickPoster(payload.movie.images),
      externalIds: {
        ...(payload.movie.tmdbId ? { tmdbId: payload.movie.tmdbId } : {}),
        ...(payload.movie.imdbId ? { imdbId: payload.movie.imdbId } : {}),
      },
      occurredAt: now,
    };
  }

  if (payload.eventType === "MovieFileDelete" && payload.movie) {
    if (isUpgradeDelete(payload.deleteReason)) return null;

    return {
      source: "radarr",
      kind: "removal",
      mediaType: "movie",
      title: payload.movie.title,
      year: payload.movie.year ?? null,
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null,
      quality: payload.movieFile?.quality ?? null,
      previousQuality: null,
      posterUrl: pickPoster(payload.movie.images),
      externalIds: {
        ...(payload.movie.tmdbId ? { tmdbId: payload.movie.tmdbId } : {}),
        ...(payload.movie.imdbId ? { imdbId: payload.movie.imdbId } : {}),
      },
      occurredAt: now,
    };
  }

  return null;
}
