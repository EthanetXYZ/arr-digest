import type { Settings } from "../config/settings.js";

export interface DigestEvent {
  id: number;
  source: string;
  kind: string; // "addition" | "removal" | "upgrade"
  mediaType: string; // "series" | "movie"
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  quality: string | null;
  previousQuality: string | null;
  posterUrl: string | null;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  thumbnail?: { url: string };
  footer?: { text: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface DiscordMessage {
  content?: string;
  embeds: DiscordEmbed[];
}

const COLORS = {
  addition: 0x57f287,
  upgrade: 0x5865f2,
  removal: 0xed4245,
} as const;

const KIND_LABEL: Record<string, string> = {
  addition: "Added",
  upgrade: "Upgraded",
  removal: "Removed",
};

const KIND_ORDER = ["addition", "upgrade", "removal"];

function episodeCode(e: DigestEvent): string {
  if (e.seasonNumber == null || e.episodeNumber == null) return "";
  const s = String(e.seasonNumber).padStart(2, "0");
  const ep = String(e.episodeNumber).padStart(2, "0");
  return `S${s}E${ep}`;
}

function formatLine(e: DigestEvent): string {
  const parts: string[] = [`**${e.title}**${e.year ? ` (${e.year})` : ""}`];
  const code = episodeCode(e);
  if (code) {
    parts.push(e.episodeTitle ? `${code} — "${e.episodeTitle}"` : code);
  }
  if (e.kind === "upgrade" && e.previousQuality && e.quality) {
    parts.push(`\`${e.previousQuality} → ${e.quality}\``);
  } else if (e.quality) {
    parts.push(`\`${e.quality}\``);
  }
  return `• ${parts.join(" — ")}`;
}

function groupKey(e: DigestEvent, groupByType: boolean): string {
  return groupByType ? `${e.kind}:${e.mediaType}` : e.kind;
}

function mediaTypeLabel(mediaType: string): string {
  return mediaType === "series" ? "TV Shows" : "Movies";
}

function buildCompactEmbeds(
  events: DigestEvent[],
  settings: Settings,
): DiscordEmbed[] {
  const groups = new Map<string, DigestEvent[]>();
  for (const e of events) {
    const key = groupKey(e, settings.groupByType);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const embeds: DiscordEmbed[] = [];
  for (const kind of KIND_ORDER) {
    const mediaTypes = settings.groupByType ? ["series", "movie"] : [""];
    for (const mediaType of mediaTypes) {
      const key = settings.groupByType ? `${kind}:${mediaType}` : kind;
      const items = groups.get(key);
      if (!items?.length) continue;

      const lines = items.map(formatLine);
      let description = lines.join("\n");
      if (description.length > 3900) {
        description = lines.slice(0, 40).join("\n") + `\n… and ${items.length - 40} more`;
      }

      const title = settings.groupByType
        ? `${KIND_LABEL[kind]} — ${mediaTypeLabel(mediaType)} (${items.length})`
        : `${KIND_LABEL[kind]} (${items.length})`;

      embeds.push({
        title,
        description,
        color: COLORS[kind as keyof typeof COLORS],
      });
    }
  }
  return embeds;
}

function buildDetailedEmbeds(
  events: DigestEvent[],
  settings: Settings,
): DiscordEmbed[] {
  const sorted = [...events].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );

  return sorted.map((e) => {
    const code = episodeCode(e);
    const descParts: string[] = [];
    if (code) descParts.push(code + (e.episodeTitle ? ` — "${e.episodeTitle}"` : ""));
    if (e.kind === "upgrade" && e.previousQuality && e.quality) {
      descParts.push(`${e.previousQuality} → ${e.quality}`);
    } else if (e.quality) {
      descParts.push(e.quality);
    }

    const embed: DiscordEmbed = {
      title: `${KIND_LABEL[e.kind]}: ${e.title}${e.year ? ` (${e.year})` : ""}`,
      description: descParts.join("\n") || undefined,
      color: COLORS[e.kind as keyof typeof COLORS],
      footer: { text: e.mediaType === "series" ? "Sonarr" : "Radarr" },
    };
    if (settings.showPoster && e.posterUrl) {
      embed.thumbnail = { url: e.posterUrl };
    }
    return embed;
  });
}

// Discord allows max 10 embeds per message; split into multiple messages.
function chunkEmbeds(embeds: DiscordEmbed[], size = 10): DiscordEmbed[][] {
  const chunks: DiscordEmbed[][] = [];
  for (let i = 0; i < embeds.length; i += size) {
    chunks.push(embeds.slice(i, i + size));
  }
  return chunks;
}

export function buildDigestMessages(
  events: DigestEvent[],
  settings: Settings,
): DiscordMessage[] {
  if (events.length === 0) return [];

  const embeds = settings.compactMode
    ? buildCompactEmbeds(events, settings)
    : buildDetailedEmbeds(events, settings);

  const chunks = chunkEmbeds(embeds);
  return chunks.map((chunk, i) => ({
    content: i === 0 ? buildHeader(events, settings) : undefined,
    embeds: chunk,
  }));
}

function buildHeader(events: DigestEvent[], settings: Settings): string | undefined {
  const mention = settings.mentionContent?.trim();
  const title = settings.digestTitle?.trim();
  const bits = [mention, title ? `**${title}**` : undefined].filter(Boolean);
  return bits.length ? bits.join(" ") : undefined;
}
