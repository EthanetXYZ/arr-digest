import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { settings } from "../db/schema.js";

export type Settings = typeof settings.$inferSelect;
export type SettingsUpdate = Partial<
  Omit<Settings, "id" | "webhookToken">
>;

export function getSettings(): Settings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) {
    throw new Error("settings row missing — bootstrapDb() must run before use");
  }
  return row;
}

export function updateSettings(patch: SettingsUpdate): Settings {
  db.update(settings).set(patch).where(eq(settings.id, 1)).run();
  return getSettings();
}

export function getDigestTimes(): string[] {
  try {
    const parsed = JSON.parse(getSettings().digestTimes);
    return Array.isArray(parsed) ? parsed.filter((t) => /^\d{2}:\d{2}$/.test(t)) : [];
  } catch {
    return [];
  }
}
