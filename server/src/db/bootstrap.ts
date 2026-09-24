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
      error TEXT,
      destination_name TEXT
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
      digest_times TEXT,
      watermark INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    -- Single login (id always 1). Kept out of settings so the password hash
    -- can never leak through GET /api/settings.
    CREATE TABLE IF NOT EXISTS auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'required',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  // CREATE TABLE IF NOT EXISTS above only shapes fresh installs; columns
  // added in later versions have to be added to existing databases here.
  addColumnIfMissing("settings", "public_url", "TEXT");
  addColumnIfMissing("destinations", "mode", "TEXT NOT NULL DEFAULT 'digest'");
  addColumnIfMissing("destinations", "digest_times", "TEXT");
  addColumnIfMissing("digest_runs", "destination_name", "TEXT");
  if (addColumnIfMissing("destinations", "watermark", "INTEGER NOT NULL DEFAULT 0")) {
    // Existing destinations start just below the oldest still-queued item,
    // so what's waiting still goes out — rather than 0, which would make
    // them re-send already-digested history.
    sqlite.exec(`UPDATE destinations SET watermark = (${INITIAL_WATERMARK_SQL})`);
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
        `INSERT INTO destinations (name, webhook_url, mention_content, watermark, created_at)
         VALUES ('Main', ?, ?, (${INITIAL_WATERMARK_SQL}), ?)`,
      )
      .run(legacy.url.trim(), legacy.mention, Date.now());
    sqlite.exec("UPDATE settings SET discord_webhook_url = NULL, mention_content = NULL WHERE id = 1");
  }
}

// Where a new destination starts: just below the oldest item still queued,
// so it picks up what's currently waiting but none of the already-sent
// history. With nothing queued, at the newest event.
export const INITIAL_WATERMARK_SQL = `COALESCE(
  (SELECT MIN(id) - 1 FROM media_events WHERE digested = 0),
  (SELECT MAX(id) FROM media_events),
  0)`;

// Returns true if the column was added (i.e. this database predates it).
function addColumnIfMissing(table: string, column: string, definition: string): boolean {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return false;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}
