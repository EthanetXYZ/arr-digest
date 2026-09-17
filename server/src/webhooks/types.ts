// Shapes below cover only the fields we use. Verified against the Sonarr/Radarr
// C# webhook payload source (NzbDrone.Core.Notifications.Webhook.*), which
// serializes with camelCase property names and PascalCase enum string values.

export interface WebhookImage {
  coverType: string; // "poster" | "fanart" | "banner" | ...
  url?: string;
  remoteUrl?: string;
}

export interface SonarrSeries {
  id: number;
  title: string;
  titleSlug?: string;
  tvdbId?: number;
  tmdbId?: number;
  imdbId?: string;
  year?: number;
  images?: WebhookImage[];
}

export interface SonarrEpisode {
  id: number;
  episodeNumber: number;
  seasonNumber: number;
  title: string;
}

export interface SonarrEpisodeFile {
  id: number;
  relativePath?: string;
  quality: string;
  size?: number;
}

export type DeleteMediaFileReason =
  | "MissingFromDisk"
  | "Manual"
  | "Upgrade"
  | "NoLinkedEpisodes"
  | "ManualOverride";

export interface SonarrWebhookPayload {
  eventType:
    | "Test"
    | "Grab"
    | "Download"
    | "Rename"
    | "SeriesAdd"
    | "SeriesDelete"
    | "EpisodeFileDelete"
    | "Health"
    | "ApplicationUpdate"
    | "HealthRestored"
    | "ManualInteractionRequired";
  series?: SonarrSeries;
  episodes?: SonarrEpisode[];
  episodeFile?: SonarrEpisodeFile;
  isUpgrade?: boolean;
  deletedFiles?: SonarrEpisodeFile[];
  deleteReason?: DeleteMediaFileReason;
}

export interface RadarrMovie {
  id: number;
  title: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  images?: WebhookImage[];
}

export interface RadarrMovieFile {
  id: number;
  relativePath?: string;
  quality: string;
  size?: number;
}

export interface RadarrWebhookPayload {
  eventType:
    | "Test"
    | "Grab"
    | "Download"
    | "Rename"
    | "MovieDelete"
    | "MovieFileDelete"
    | "Health"
    | "ApplicationUpdate"
    | "MovieAdded"
    | "HealthRestored"
    | "ManualInteractionRequired";
  movie?: RadarrMovie;
  movieFile?: RadarrMovieFile;
  isUpgrade?: boolean;
  deletedFiles?: RadarrMovieFile[];
  deleteReason?: DeleteMediaFileReason;
}
