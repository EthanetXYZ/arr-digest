import { useEffect, useState } from "react";
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

// Click once to arm, click again within a few seconds to actually remove —
// cheap insurance against a stray click deleting something you meant to
// keep, without a disruptive native confirm() dialog.
function RemoveButton({ onConfirm, title }: { onConfirm: () => void; title: string }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (confirming) {
          onConfirm();
        } else {
          setConfirming(true);
        }
      }}
      title={confirming ? "Click again to confirm" : title}
      className={`flex-none rounded px-1.5 py-0.5 text-xs font-medium transition ${
        confirming
          ? "bg-removal/20 text-removal"
          : "text-slate-500 hover:bg-slate-800 hover:text-removal"
      }`}
    >
      {confirming ? "Confirm?" : "✕"}
    </button>
  );
}

function ItemDetail({ event: e }: { event: MediaEvent }) {
  const code = episodeCode(e);
  const quality =
    e.kind === "upgrade" && e.previousQuality && e.quality
      ? { from: e.previousQuality, to: e.quality }
      : e.quality
        ? { from: null, to: e.quality }
        : null;

  return (
    <div className="min-w-0 flex-1 text-sm">
      {(code || e.episodeTitle) && (
        <div className="truncate text-slate-400">
          {code}
          {code && e.episodeTitle ? " — " : ""}
          {e.episodeTitle ? `"${e.episodeTitle}"` : null}
        </div>
      )}
      {quality && (
        <div className="text-slate-500">
          {quality.from ? (
            <>
              <span className="line-through">{quality.from}</span>
              {" → "}
              <span className="text-slate-300">{quality.to}</span>
            </>
          ) : (
            quality.to
          )}
        </div>
      )}
    </div>
  );
}

export function EventCard({
  events,
  onRemove,
}: {
  events: MediaEvent[];
  onRemove: (id: number) => void;
}) {
  const first = events[0];
  const style = KIND_STYLES[first.kind];
  const isBatch = events.length > 1;
  const mostRecent = Math.max(...events.map((e) => e.occurredAt));
  const [expanded, setExpanded] = useState(false);

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
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex gap-3">
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
            {!isBatch && (
              <RemoveButton
                title="Remove from next digest"
                onConfirm={() => onRemove(first.id)}
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => isBatch && setExpanded((v) => !v)}
            className={`mt-1 block w-full truncate text-left font-medium text-slate-100 ${isBatch ? "cursor-pointer hover:text-slate-300" : ""}`}
          >
            {first.title}
            {first.year ? <span className="text-slate-400"> ({first.year})</span> : null}
            {isBatch && <span className="ml-1 text-xs text-slate-500">{expanded ? "▾" : "▸"}</span>}
          </button>

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

      {isBatch && (
        <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2">
          <span className="text-xs text-slate-500">
            {expanded ? "Individual episodes" : `${events.length} episodes — click title to view`}
          </span>
          <RemoveButton title="Remove all episodes in this batch" onConfirm={() => events.forEach((e) => onRemove(e.id))} />
        </div>
      )}

      {isBatch && expanded && (
        <div className="mt-2 flex flex-col gap-2 border-t border-slate-800 pt-2">
          {events
            .slice()
            .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
            .map((e) => (
              <div key={e.id} className="flex items-center gap-2">
                <ItemDetail event={e} />
                <RemoveButton title="Remove this episode" onConfirm={() => onRemove(e.id)} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
