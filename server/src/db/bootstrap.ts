import crypto from "node:crypto";
import { sqlite } from "./client.js";

// Idempotent schema bootstrap. Simple CREATE TABLE IF NOT EXISTS is enough
// for a small self-hosted app and avoids shipping a migration toolchain.
export function bootstrapDb() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_webhook_url TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      digest_times TEXT NOT NULL DEFAULT '["09:00"]',
      digest_enabled INTEGER NOT NULL DEFAULT 1,
      digest_title TEXT NOT NULL DEFAULT 'Library Digest',
      group_by_type INTEGER NOT NULL DEFAULT 1,
      show_poster INTEGER NOT NULL DEFAULT 1,
      compact_mode INTEGER NOT NULL DEFAULT 1,
      skip_if_empty INTEGER NOT NULL DEFAULT 1,
      mention_content TEXT,
      webhook_token TEXT NOT NULL,
      public_url TEXT
    );

    CREATE TABLE IF NOT EXISTS media_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      season_number INTEGER,
      episode_number INTEGER,
      episode_title TEXT,
      quality TEXT,
      previous_quality TEXT,
      poster_url TEXT,
      external_ids TEXT,
      occurred_at INTEGER NOT NULL,
      digested INTEGER NOT NULL DEFAULT 0,
      digested_at INTEGER,
      raw_payload TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_media_events_digested ON media_events (digested);
    CREATE INDEX IF NOT EXISTS idx_media_events_occurred_at ON media_events (occurred_at);

    CREATE TABLE IF NOT EXISTS digest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at INTEGER NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS destinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      mode TEXT NOT NULL DEFAULT 'digest',
      include_additions INTEGER NOT NULL DEFAULT 1,
      include_upgrades INTEGER NOT NULL DEFAULT 1,
      include_removals INTEGER NOT NULL DEFAULT 1,
      include_movies INTEGER NOT NULL DEFAULT 1,
      include_series INTEGER NOT NULL DEFAULT 1,
      mention_content TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // Existing databases predate the public_url column; CREATE TABLE IF NOT
  // EXISTS above only applies to fresh installs, so add it here too.
  const columns = sqlite.prepare("PRAGMA table_info(settings)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "public_url")) {
    sqlite.exec("ALTER TABLE settings ADD COLUMN public_url TEXT");
  }

  // Same story for destinations.mode, added after the destinations table.
  const destColumns = sqlite.prepare("PRAGMA table_info(destinations)").all() as { name: string }[];
  if (!destColumns.some((c) => c.name === "mode")) {
    sqlite.exec("ALTER TABLE destinations ADD COLUMN mode TEXT NOT NULL DEFAULT 'digest'");
  }

  const row = sqlite.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!row) {
    sqlite
      .prepare("INSERT INTO settings (id, webhook_token) VALUES (1, ?)")
      .run(crypto.randomBytes(16).toString("hex"));
  }

  // The single settings.discord_webhook_url predates destinations. Move it
  // into a catch-all "Main" destination once, then clear it — clearing is
  // what stops this from re-creating "Main" if the user later deletes it.
  const legacy = sqlite
    .prepare("SELECT discord_webhook_url AS url, mention_content AS mention FROM settings WHERE id = 1")
    .get() as { url: string | null; mention: string | null };
  if (legacy.url?.trim()) {
    sqlite
      .prepare(
        "INSERT INTO destinations (name, webhook_url, mention_content, created_at) VALUES ('Main', ?, ?, ?)",
      )
      .run(legacy.url.trim(), legacy.mention, Date.now());
    sqlite.exec("UPDATE settings SET discord_webhook_url = NULL, mention_content = NULL WHERE id = 1");
  }
}
