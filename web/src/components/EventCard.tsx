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

export function EventCard({ event }: { event: MediaEvent }) {
  const style = KIND_STYLES[event.kind];
  const code = episodeCode(event);

  return (
    <div
      className={`flex gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 ${
        event.digested ? "opacity-50" : ""
      }`}
    >
      {event.posterUrl ? (
        <img
          src={event.posterUrl}
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
          <span className="text-xs uppercase tracking-wide text-slate-500">
            {event.source}
          </span>
          <span className="ml-auto text-xs text-slate-500">{timeAgo(event.occurredAt)}</span>
        </div>

        <div className="mt-1 truncate font-medium text-slate-100">
          {event.title}
          {event.year ? <span className="text-slate-400"> ({event.year})</span> : null}
        </div>

        {(code || event.episodeTitle) && (
          <div className="truncate text-sm text-slate-400">
            {code}
            {code && event.episodeTitle ? " — " : ""}
            {event.episodeTitle ? `"${event.episodeTitle}"` : null}
          </div>
        )}

        <div className="mt-1 text-sm">
          {event.kind === "upgrade" && event.previousQuality && event.quality ? (
            <span className="text-slate-400">
              <span className="text-slate-500 line-through">{event.previousQuality}</span>
              {" → "}
              <span className="text-slate-200">{event.quality}</span>
            </span>
          ) : event.quality ? (
            <span className="text-slate-400">{event.quality}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
