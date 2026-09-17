import type { MediaEvent } from "../types";

const KIND_STYLES: Record<MediaEvent["kind"], { label: string; badge: string }> = {
  addition: { label: "Added", badge: "bg-addition/15 text-addition border-addition/30" },
  upgrade: { label: "Upgraded", badge: "bg-upgrade/15 text-upgrade border-upgrade/30" },
  removal: { label: "Removed", badge: "bg-removal/15 text-removal border-removal/30" },
};

function timeAgo(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(ts).toLocaleString();
}

function episodeCode(e: MediaEvent): string | null {
  if (e.seasonNumber == null || e.episodeNumber == null) return null;
  return `S${String(e.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`;
}

function seasonRange(events: MediaEvent[]): string {
  const season = `S${String(events[0].seasonNumber).padStart(2, "0")}`;
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

export function EventCard({ events }: { events: MediaEvent[] }) {
  const first = events[0];
  const style = KIND_STYLES[first.kind];
  const isBatch = events.length > 1;
  const mostRecent = Math.max(...events.map((e) => e.occurredAt));

  const code = isBatch ? seasonRange(events) : episodeCode(first);

  const consistentQuality = isBatch
    ? first.kind === "upgrade"
      ? events.every((e) => e.previousQuality === first.previousQuality && e.quality === first.quality)
        ? { from: first.previousQuality, to: first.quality }
        : null
      : events.every((e) => e.quality === first.quality)
        ? { from: null, to: first.quality }
        : null
    : first.kind === "upgrade" && first.previousQuality && first.quality
      ? { from: first.previousQuality, to: first.quality }
      : first.quality
        ? { from: null, to: first.quality }
        : null;

  return (
    <div className="flex gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      {first.posterUrl ? (
        <img
          src={first.posterUrl}
          alt=""
          className="h-16 w-11 flex-none rounded object-cover bg-slate-800"
          loading="lazy"
        />
      ) : (
        <div className="h-16 w-11 flex-none rounded bg-slate-800" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${style.badge}`}>
            {style.label}
          </span>
          <span className="text-xs uppercase tracking-wide text-slate-500">{first.source}</span>
          <span className="ml-auto text-xs text-slate-500">{timeAgo(mostRecent)}</span>
        </div>

        <div className="mt-1 truncate font-medium text-slate-100">
          {first.title}
          {first.year ? <span className="text-slate-400"> ({first.year})</span> : null}
        </div>

        {(code || (!isBatch && first.episodeTitle)) && (
          <div className="truncate text-sm text-slate-400">
            {code}
            {code && !isBatch && first.episodeTitle ? " — " : ""}
            {!isBatch && first.episodeTitle ? `"${first.episodeTitle}"` : null}
          </div>
        )}

        <div className="mt-1 text-sm">
          {consistentQuality?.from ? (
            <span className="text-slate-400">
              <span className="text-slate-500 line-through">{consistentQuality.from}</span>
              {" → "}
              <span className="text-slate-200">{consistentQuality.to}</span>
            </span>
          ) : consistentQuality?.to ? (
            <span className="text-slate-400">{consistentQuality.to}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
