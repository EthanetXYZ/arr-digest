import type { DigestEvent } from "./builder.js";

// Static, illustrative data for previews/test sends — never persisted, never
// counted as real activity. Posters use placehold.co so previews always
// render something even with no network access to real artwork services.
function poster(label: string): string {
  return `https://placehold.co/300x450/1f2937/e5e7eb?text=${encodeURIComponent(label)}`;
}

export function getSampleEvents(): DigestEvent[] {
  const seasonEpisodes: DigestEvent[] = Array.from({ length: 6 }, (_, i) => ({
    id: -100 - i,
    source: "sonarr",
    kind: "addition",
    mediaType: "series",
    title: "Severance",
    year: 2022,
    seasonNumber: 2,
    episodeNumber: i + 1,
    episodeTitle: `Episode ${i + 1}`,
    quality: "WEBDL-1080p",
    previousQuality: null,
    posterUrl: poster("Severance"),
  }));

  return [
    {
      id: -1,
      source: "radarr",
      kind: "addition",
      mediaType: "movie",
      title: "Dune: Part Two",
      year: 2024,
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null,
      quality: "Bluray-2160p",
      previousQuality: null,
      posterUrl: poster("Dune Part Two"),
    },
    ...seasonEpisodes,
    {
      id: -200,
      source: "sonarr",
      kind: "upgrade",
      mediaType: "series",
      title: "The Bear",
      year: 2022,
      seasonNumber: 1,
      episodeNumber: 1,
      episodeTitle: "System",
      quality: "Bluray-1080p",
      previousQuality: "WEBDL-720p",
      posterUrl: poster("The Bear"),
    },
    {
      id: -300,
      source: "radarr",
      kind: "removal",
      mediaType: "movie",
      title: "The Gray Man",
      year: 2022,
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null,
      quality: "WEBDL-720p",
      previousQuality: null,
      posterUrl: poster("The Gray Man"),
    },
  ];
}
