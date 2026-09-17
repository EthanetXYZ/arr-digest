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
  `);

  // Existing databases predate the public_url column; CREATE TABLE IF NOT
  // EXISTS above only applies to fresh installs, so add it here too.
  const columns = sqlite.prepare("PRAGMA table_info(settings)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "public_url")) {
    sqlite.exec("ALTER TABLE settings ADD COLUMN public_url TEXT");
  }

  const row = sqlite.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!row) {
    sqlite
      .prepare("INSERT INTO settings (id, webhook_token) VALUES (1, ?)")
      .run(crypto.randomBytes(16).toString("hex"));
  }
}
