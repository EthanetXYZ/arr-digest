import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { destinations } from "../db/schema.js";
import { getSettings, type Settings } from "../config/settings.js";
import type { DigestEvent } from "./builder.js";

export type Destination = typeof destinations.$inferSelect;
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
}

export function eventMatchesDestination(e: DigestEvent, d: Destination): boolean {
  const kindOk =
    (e.kind === "addition" && d.includeAdditions) ||
    (e.kind === "upgrade" && d.includeUpgrades) ||
    (e.kind === "removal" && d.includeRemovals);
  const mediaOk =
    (e.mediaType === "movie" && d.includeMovies) || (e.mediaType === "series" && d.includeSeries);
  return kindOk && mediaOk;
}

// Format overrides a caller may apply on top of saved settings (the live
// preview uses these to reflect unsaved edits).
export interface FormatOverrides {
  digestTitle?: string;
  groupByType?: boolean;
  showPoster?: boolean;
  compactMode?: boolean;
}

// The settings a message to `dest` is rendered with: its own mention, and no
// digest title for instant destinations — "Library Digest" heads a scheduled
// summary, not a one-off push.
export function renderSettingsFor(dest: Destination | undefined, overrides: FormatOverrides = {}): Settings {
  return {
    ...getSettings(),
    ...overrides,
    ...(dest?.mode === "instant" ? { digestTitle: "" } : {}),
    mentionContent: dest?.mentionContent ?? null,
  };
}

// Returns an error message, or null if the input is usable.
export function validateDestination(input: Partial<DestinationInput>): string | null {
  if (!input.name?.trim()) return "Name is required";
  if (input.mode !== "digest" && input.mode !== "instant") return "Delivery must be digest or instant";
  if (!input.webhookUrl?.trim()) return "Webhook URL is required";
  try {
    const url = new URL(input.webhookUrl.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "Webhook URL must be http(s)";
  } catch {
    return "Webhook URL isn't a valid URL";
  }
  return null;
}

function normalize(input: DestinationInput) {
  return {
    name: input.name.trim(),
    webhookUrl: input.webhookUrl.trim(),
    enabled: input.enabled,
    mode: input.mode,
    includeAdditions: input.includeAdditions,
    includeUpgrades: input.includeUpgrades,
    includeRemovals: input.includeRemovals,
    includeMovies: input.includeMovies,
    includeSeries: input.includeSeries,
    mentionContent: input.mentionContent?.trim() || null,
  };
}

export function listDestinations(): Destination[] {
  return db.select().from(destinations).orderBy(destinations.id).all();
}

export function getDestination(id: number): Destination | undefined {
  return db.select().from(destinations).where(eq(destinations.id, id)).get();
}

export function createDestination(input: DestinationInput): Destination {
  return db
    .insert(destinations)
    .values({ ...normalize(input), createdAt: Date.now() })
    .returning()
    .get();
}

export function updateDestination(id: number, input: DestinationInput): Destination | undefined {
  return db
    .update(destinations)
    .set(normalize(input))
    .where(eq(destinations.id, id))
    .returning()
    .get();
}

export function deleteDestination(id: number): boolean {
  return db.delete(destinations).where(eq(destinations.id, id)).run().changes > 0;
}
