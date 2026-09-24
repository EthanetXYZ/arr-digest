import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Singleton row (id always 1) holding all user-configurable settings.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  discordWebhookUrl: text("discord_webhook_url"),
  timezone: text("timezone").notNull().default("UTC"),
  // JSON array of "HH:mm" strings, e.g. ["09:00", "20:00"]
  digestTimes: text("digest_times").notNull().default("[\"09:00\"]"),
  digestEnabled: integer("digest_enabled", { mode: "boolean" }).notNull().default(true),
  digestTitle: text("digest_title").notNull().default("Library Digest"),
  groupByType: integer("group_by_type", { mode: "boolean" }).notNull().default(true),
  showPoster: integer("show_poster", { mode: "boolean" }).notNull().default(true),
  compactMode: integer("compact_mode", { mode: "boolean" }).notNull().default(true),
  skipIfEmpty: integer("skip_if_empty", { mode: "boolean" }).notNull().default(true),
  mentionContent: text("mention_content"),
  webhookToken: text("webhook_token").notNull(),
  // Overrides the browser-detected origin when building the webhook URLs
  // shown in Settings, e.g. "http://192.168.10.190:8080" — needed because
  // Sonarr/Radarr (often in other containers) can't resolve "localhost".
  publicUrl: text("public_url"),
});

export const mediaEvents = sqliteTable("media_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(), // "sonarr" | "radarr"
  kind: text("kind").notNull(), // "addition" | "removal" | "upgrade"
  mediaType: text("media_type").notNull(), // "series" | "movie"
  title: text("title").notNull(),
  year: integer("year"),
  seasonNumber: integer("season_number"),
  episodeNumber: integer("episode_number"),
  episodeTitle: text("episode_title"),
  quality: text("quality"),
  previousQuality: text("previous_quality"),
  posterUrl: text("poster_url"),
  externalIds: text("external_ids"), // JSON: { tvdbId, tmdbId, imdbId }
  occurredAt: integer("occurred_at").notNull(), // unix ms
  digested: integer("digested", { mode: "boolean" }).notNull().default(false),
  digestedAt: integer("digested_at"),
  rawPayload: text("raw_payload"),
  createdAt: integer("created_at").notNull(),
});

// A Discord webhook plus which slice of events it receives — lets e.g.
// removals go to one channel and upgrades to another.
export const destinations = sqliteTable("destinations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // "digest": sent in the scheduled digest. "instant": pushed shortly after
  // each event arrives (see digest/instant.ts).
  mode: text("mode").notNull().default("digest"),
  includeAdditions: integer("include_additions", { mode: "boolean" }).notNull().default(true),
  includeUpgrades: integer("include_upgrades", { mode: "boolean" }).notNull().default(true),
  includeRemovals: integer("include_removals", { mode: "boolean" }).notNull().default(true),
  includeMovies: integer("include_movies", { mode: "boolean" }).notNull().default(true),
  includeSeries: integer("include_series", { mode: "boolean" }).notNull().default(true),
  mentionContent: text("mention_content"),
  createdAt: integer("created_at").notNull(),
});

export const digestRuns = sqliteTable("digest_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ranAt: integer("ran_at").notNull(),
  eventCount: integer("event_count").notNull().default(0),
  status: text("status").notNull(), // "sent" | "skipped_empty" | "error"
  error: text("error"),
});
