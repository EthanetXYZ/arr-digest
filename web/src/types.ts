export type EventKind = "addition" | "removal" | "upgrade";
export type MediaType = "series" | "movie";

export interface MediaEvent {
  id: number;
  source: "sonarr" | "radarr";
  kind: EventKind;
  mediaType: MediaType;
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  quality: string | null;
  previousQuality: string | null;
  posterUrl: string | null;
  externalIds: string | null;
  occurredAt: number;
  digested: boolean;
  digestedAt: number | null;
  createdAt: number;
}

export interface Settings {
  id: number;
  discordWebhookUrl: string | null;
  timezone: string;
  digestTimes: string[];
  digestEnabled: boolean;
  digestTitle: string;
  groupByType: boolean;
  showPoster: boolean;
  compactMode: boolean;
  skipIfEmpty: boolean;
  mentionContent: string | null;
  webhookToken: string;
  publicUrl: string | null;
}

export interface NetworkInfo {
  addresses: string[];
  port: string | null;
}

export interface VersionInfo {
  version: string;
  commit: string;
  builtAt: string | null;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  thumbnail?: { url: string };
  footer?: { text: string };
}

export interface DiscordMessage {
  content?: string;
  embeds: DiscordEmbed[];
}

export type PreviewOverrides = Pick<
  Settings,
  "digestTitle" | "groupByType" | "showPoster" | "compactMode"
>;

export type DeliveryMode = "digest" | "instant";

export interface DestinationInput {
  name: string;
  webhookUrl: string;
  enabled: boolean;
  mode: DeliveryMode;
  includeAdditions: boolean;
  includeUpgrades: boolean;
  includeRemovals: boolean;
  includeMovies: boolean;
  includeSeries: boolean;
  mentionContent: string | null;
  // null = follow the main schedule
  digestTimes: string[] | null;
}

export interface Destination extends DestinationInput {
  id: number;
  createdAt: number;
}

export interface DigestRun {
  id: number;
  ranAt: number;
  eventCount: number;
  status: "sent" | "skipped_empty" | "error";
  error: string | null;
  destinationName: string | null;
}

export type WsMessage =
  | { type: "backlog"; events: MediaEvent[] }
  | { type: "event"; event: MediaEvent }
  | { type: "digest_sent"; eventCount: number; ranAt: number; eventIds: number[] }
  | { type: "digest_error"; error: string; ranAt: number }
  | { type: "event_removed"; id: number };
