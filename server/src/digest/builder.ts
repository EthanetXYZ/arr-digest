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

type DisplayUnit = { events: DigestEvent[] };

// How many items a set of events shows up as — a season batch counts once,
// not once per episode. Every count shown to people (section headers,
// history, "last digest sent N items") uses this, so it matches the lines
// they actually see.
export function countDisplayUnits(events: DigestEvent[]): number {
  return groupIntoDisplayUnits(events).length;
}

// Multiple episodes of the same show + season + kind (e.g. a whole season
// pack landing at once) are collapsed into one unit instead of one line/embed
// per episode — otherwise a season premiere blows past Discord's embed limits.
function groupIntoDisplayUnits(events: DigestEvent[]): DisplayUnit[] {
  const seasonGroups = new Map<string, DigestEvent[]>();
  const order: string[] = [];
  const singles: DigestEvent[] = [];

  for (const e of events) {
    if (e.mediaType === "series" && e.seasonNumber != null) {
      const key = `${e.kind}|${e.title}|${e.year}|${e.seasonNumber}`;
      if (!seasonGroups.has(key)) {
        seasonGroups.set(key, []);
        order.push(key);
      }
      seasonGroups.get(key)!.push(e);
    } else {
      singles.push(e);
    }
  }

  const units: DisplayUnit[] = order.map((key) => ({ events: seasonGroups.get(key)! }));
  for (const e of singles) units.push({ events: [e] });
  return units;
}

function seasonSummaryText(events: DigestEvent[]): string {
  const first = events[0];
  const season = `S${String(first.seasonNumber).padStart(2, "0")}`;
  const episodeNumbers = events
    .map((e) => e.episodeNumber)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);

  const range =
    episodeNumbers.length > 1
      ? `E${String(episodeNumbers[0]).padStart(2, "0")}–E${String(episodeNumbers[episodeNumbers.length - 1]).padStart(2, "0")}`
      : episodeNumbers.length === 1
        ? `E${String(episodeNumbers[0]).padStart(2, "0")}`
        : "";

  return `${season}${range} (${events.length} episodes)`;
}

// Quality is only shown for a consolidated season when every episode in it
// agrees — a mixed-quality batch is more confusing to summarize than to omit.
function consistentQuality(events: DigestEvent[]): { from: string | null; to: string } | null {
  const first = events[0];
  if (!first.quality) return null;

  if (first.kind === "upgrade") {
    const consistent = events.every(
      (e) => e.previousQuality === first.previousQuality && e.quality === first.quality,
    );
    return consistent && first.previousQuality ? { from: first.previousQuality, to: first.quality } : null;
  }

  const consistent = events.every((e) => e.quality === first.quality);
  return consistent ? { from: null, to: first.quality } : null;
}

function formatSeasonLine(events: DigestEvent[]): string {
  const first = events[0];
  const parts: string[] = [
    `**${first.title}**${first.year ? ` (${first.year})` : ""}`,
    seasonSummaryText(events),
  ];

  const quality = consistentQuality(events);
  if (quality) {
    parts.push(quality.from ? `\`${quality.from} → ${quality.to}\`` : `\`${quality.to}\``);
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

      const units = groupIntoDisplayUnits(items);
      const lines = units.map((u) => (u.events.length > 1 ? formatSeasonLine(u.events) : formatLine(u.events[0])));
      let description = lines.join("\n");
      if (description.length > 3900) {
        description = lines.slice(0, 40).join("\n") + `\n… and ${lines.length - 40} more`;
      }

      const title = settings.groupByType
        ? `${KIND_LABEL[kind]} — ${mediaTypeLabel(mediaType)} (${units.length})`
        : `${KIND_LABEL[kind]} (${units.length})`;

      embeds.push({
        title,
        description,
        color: COLORS[kind as keyof typeof COLORS],
      });
    }
  }
  return embeds;
}

function buildUnitEmbed(events: DigestEvent[], settings: Settings): DiscordEmbed {
  const first = events[0];

  if (events.length > 1) {
    const descParts = [seasonSummaryText(events)];
    const quality = consistentQuality(events);
    if (quality) {
      descParts.push(quality.from ? `${quality.from} → ${quality.to}` : quality.to);
    }

    const embed: DiscordEmbed = {
      title: `${KIND_LABEL[first.kind]}: ${first.title}${first.year ? ` (${first.year})` : ""}`,
      description: descParts.join("\n"),
      color: COLORS[first.kind as keyof typeof COLORS],
      footer: { text: "Sonarr" },
    };
    if (settings.showPoster && first.posterUrl) embed.thumbnail = { url: first.posterUrl };
    return embed;
  }

  const e = first;
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
}

function buildDetailedEmbeds(
  events: DigestEvent[],
  settings: Settings,
): DiscordEmbed[] {
  const sorted = [...events].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const units = groupIntoDisplayUnits(sorted);
  return units.map((u) => buildUnitEmbed(u.events, settings));
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

// Placeholders for the digest title, filled in from the events in that
// message (so each destination's digest counts only what it received).
// Counts are items as shown — a season batch is one — except {episodes}.
//   {added}            -> "3"
//   {added:item}       -> "3 items" / "1 item"
//   {count:entry|entries} -> irregular plural, given after "|"
//   {movies:movie, episodes:episode}
//                      -> a list: zeros are left out and the rest joined
//                         naturally ("2 movies & 7 episodes", "7 episodes",
//                         "2 movies, 3 shows & 7 episodes"); all zero ->
//                         "no movies or episodes"
//   {was|were}         -> agrees with the count just before it: the first
//                         form after exactly one thing, else the second
//                         ("1 movie was added", "2 movies were added")
// Anything unrecognised is left as typed, so literal braces survive.
// {movies}, {shows} and {episodes} count every kind; prefixed with added_,
// upgraded_ or removed_ they count only that kind — "{movies} were added"
// would otherwise count a removed movie as added.
const KIND_PREFIXES = { added: "addition", upgraded: "upgrade", removed: "removal" } as const;
const MEDIA_COUNTS = ["movies", "shows", "episodes"] as const;
export const TITLE_VARIABLES = [
  "count",
  ...(Object.keys(KIND_PREFIXES) as (keyof typeof KIND_PREFIXES)[]),
  ...MEDIA_COUNTS,
  ...(Object.keys(KIND_PREFIXES) as (keyof typeof KIND_PREFIXES)[]).flatMap((k) =>
    MEDIA_COUNTS.map((m) => `${k}_${m}` as const),
  ),
] as const;

type TitleVariable = (typeof TITLE_VARIABLES)[number];

interface TitlePart {
  name: TitleVariable;
  word?: string;
  plural?: string;
}

function parseTitlePart(text: string): TitlePart | null {
  const m = text.trim().match(/^(\w+)\s*(?::\s*([^|]+?)\s*(?:\|\s*(.+))?)?$/);
  if (!m || !(TITLE_VARIABLES as readonly string[]).includes(m[1])) return null;
  return { name: m[1] as TitleVariable, word: m[2]?.trim(), plural: m[3]?.trim() };
}

const pluralOf = (p: TitlePart) => p.plural ?? `${p.word}s`;

function formatTitlePart(p: TitlePart, n: number): string {
  if (!p.word) return String(n);
  return `${n} ${n === 1 ? p.word : pluralOf(p)}`;
}

// "a", "a & b", "a, b & c"
function joinList(items: string[], last: string): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}`;
}

// The title as it goes out: left off entirely when it has counts and every
// one of them is zero ("no movies or episodes were added" says nothing
// useful — e.g. a digest of only removals under an additions title).
export function renderDigestTitle(template: string, events: DigestEvent[]): string {
  const { text, counted, anyNonZero } = fillTitle(template, events);
  return counted && !anyNonZero ? "" : text.trim();
}

export function renderTitle(template: string, events: DigestEvent[]): string {
  return fillTitle(template, events).text;
}

function fillTitle(
  template: string,
  events: DigestEvent[],
): { text: string; counted: boolean; anyNonZero: boolean } {
  const mediaCounts = (subset: DigestEvent[]) => {
    const series = subset.filter((e) => e.mediaType === "series");
    return {
      movies: subset.filter((e) => e.mediaType === "movie").length,
      shows: new Set(series.map((e) => `${e.title}|${e.year}`)).size,
      episodes: series.length,
    };
  };
  const values = { count: countDisplayUnits(events), ...mediaCounts(events) } as Record<TitleVariable, number>;
  for (const [prefix, kind] of Object.entries(KIND_PREFIXES)) {
    const ofKind = events.filter((e) => e.kind === kind);
    values[prefix as TitleVariable] = countDisplayUnits(ofKind);
    for (const [media, n] of Object.entries(mediaCounts(ofKind))) {
      values[`${prefix}_${media}` as TitleVariable] = n;
    }
  }

  // Whether the most recent count rendered (left to right) was exactly one
  // thing, for {was|were}. replace() calls back in order, so this tracks it.
  let lastWasOne = false;
  let counted = false;
  let anyNonZero = false;

  const text = template.replace(/\{([^{}]+)\}/g, (match, body: string) => {
    const agreement = body.match(/^\s*([^|:,]+?)\s*\|\s*([^|:,]+?)\s*$/);
    if (agreement && !(TITLE_VARIABLES as readonly string[]).includes(agreement[1])) {
      return lastWasOne ? agreement[1] : agreement[2];
    }

    const parts = body.split(",").map(parseTitlePart);
    if (parts.some((p) => p === null)) return match;
    const valid = parts as TitlePart[];
    counted = true;
    if (valid.some((p) => values[p.name] > 0)) anyNonZero = true;

    if (valid.length === 1) {
      lastWasOne = values[valid[0].name] === 1;
      return formatTitlePart(valid[0], values[valid[0].name]);
    }

    const shown = valid.filter((p) => values[p.name] > 0);
    lastWasOne = shown.length === 1 && values[shown[0].name] === 1;
    if (shown.length > 0) return joinList(shown.map((p) => formatTitlePart(p, values[p.name])), "&");
    // Nothing to list. Worded parts read as "no movies or episodes"; bare
    // numbers can only honestly be "0".
    return valid.every((p) => p.word) ? `no ${joinList(valid.map(pluralOf), "or")}` : "0";
  });

  return { text, counted, anyNonZero };
}

function buildHeader(events: DigestEvent[], settings: Settings): string | undefined {
  const mention = settings.mentionContent?.trim();
  const title = renderDigestTitle(settings.digestTitle ?? "", events);
  const bits = [mention, title ? `**${title}**` : undefined].filter(Boolean);
  return bits.length ? bits.join(" ") : undefined;
}
