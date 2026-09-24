import { useMemo, useState } from "react";
import { useLiveEventsContext } from "../context/LiveEventsContext";
import { EventCard } from "../components/EventCard";
import { groupLiveEvents } from "../lib/groupEvents";
import { api } from "../api";
import type { EventKind } from "../types";

const FILTERS: { key: EventKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "addition", label: "Added" },
  { key: "upgrade", label: "Upgraded" },
  { key: "removal", label: "Removed" },
];

function timeAgo(ts: number): string {
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  return diffHr < 24 ? `${diffHr}h ago` : new Date(ts).toLocaleString();
}

export function LiveFeed() {
  const { events, status, lastDigest, lastRun } = useLiveEventsContext();
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [bannerDismissedAt, setBannerDismissedAt] = useState<number | null>(null);

  // Everything in `events` is inherently still pending — already-digested
  // items are dropped from state entirely (see useLiveEvents) rather than
  // just dimmed, so the feed doesn't pile up with old, already-sent items.
  const pendingCount = events.length;
  const filtered = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.kind === filter)),
    [events, filter],
  );
  const groups = useMemo(() => groupLiveEvents(filtered), [filtered]);

  const showBanner = lastRun && !lastRun.ok && lastRun.ranAt !== bannerDismissedAt;

  async function handleRemove(id: number) {
    try {
      const res = await api.removeEvent(id);
      if (!res.ok) setSendResult(res.error ?? "Couldn't remove that item.");
    } catch (err) {
      setSendResult(err instanceof Error ? err.message : "Couldn't remove that item.");
    }
  }

  async function sendNow() {
    setSending(true);
    setSendResult(null);
    try {
      const res = await api.runDigestNow();
      setSendResult(
        !res.ok ? (res.error ?? "Failed to send.") : res.warning ? `Sent, but: ${res.warning}` : "Digest sent.",
      );
    } catch (err) {
      setSendResult(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {showBanner && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-removal/30 bg-removal/10 p-3 text-sm">
          <span className="mt-0.5 text-removal">⚠</span>
          <div className="flex-1">
            <span className="font-medium text-removal">Last send to Discord failed</span>
            <span className="text-slate-400"> — {timeAgo(lastRun!.ranAt)}</span>
            <div className="mt-0.5 text-slate-400">{lastRun!.error}</div>
          </div>
          <button
            onClick={() => setBannerDismissedAt(lastRun!.ranAt)}
            className="text-slate-500 hover:text-slate-300"
          >
            ✕
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span
            className={`h-2 w-2 rounded-full ${
              status === "open" ? "bg-addition" : status === "connecting" ? "bg-yellow-400" : "bg-removal"
            }`}
          />
          {status === "open" ? "Live" : status === "connecting" ? "Connecting…" : "Disconnected"}
        </div>

        <div className="text-sm text-slate-400">
          <span className="font-medium text-slate-200">{pendingCount}</span> pending for next digest
        </div>

        {lastDigest && (
          <div className="text-sm text-slate-500">
            Last digest sent {lastDigest.eventCount} item{lastDigest.eventCount === 1 ? "" : "s"}
          </div>
        )}

        <button
          onClick={sendNow}
          disabled={sending || pendingCount === 0}
          title={pendingCount === 0 ? "Nothing queued for a digest yet" : undefined}
          className="ml-auto rounded-md bg-upgrade px-3 py-1.5 text-sm font-medium text-white transition hover:bg-upgrade/80 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send digest now"}
        </button>
      </div>

      {sendResult && <div className="mb-4 text-sm text-slate-400">{sendResult}</div>}

      <div className="mb-4 flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition ${
              filter === f.key ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {groups.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-slate-500">
            No events yet. Add the webhook URL to Sonarr/Radarr's Connect settings and trigger an
            import to see it appear here.
          </div>
        )}
        {groups.map((group) => (
          <EventCard key={group[0].id} events={group} onRemove={handleRemove} />
        ))}
      </div>
    </div>
  );
}
