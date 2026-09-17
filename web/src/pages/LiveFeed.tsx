import { useMemo, useState } from "react";
import { useLiveEventsContext } from "../context/LiveEventsContext";
import { EventCard } from "../components/EventCard";
import { api } from "../api";
import type { EventKind } from "../types";

const FILTERS: { key: EventKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "addition", label: "Added" },
  { key: "upgrade", label: "Upgraded" },
  { key: "removal", label: "Removed" },
];

export function LiveFeed() {
  const { events, status, lastDigest } = useLiveEventsContext();
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  // Everything in `events` is inherently still pending — already-digested
  // items are dropped from state entirely (see useLiveEvents) rather than
  // just dimmed, so the feed doesn't pile up with old, already-sent items.
  const pendingCount = events.length;
  const filtered = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.kind === filter)),
    [events, filter],
  );

  async function sendNow() {
    setSending(true);
    setSendResult(null);
    try {
      const res = await api.runDigestNow();
      setSendResult(res.ok ? "Digest sent." : res.error ?? "Failed to send.");
    } catch (err) {
      setSendResult(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
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
        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-slate-500">
            No events yet. Add the webhook URL to Sonarr/Radarr's Connect settings and trigger an
            import to see it appear here.
          </div>
        )}
        {filtered.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
