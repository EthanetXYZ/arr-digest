import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { MediaEvent, WsMessage } from "../types";

export type ConnectionState = "connecting" | "open" | "closed";
export type LastRun = { ok: boolean; error?: string; ranAt: number };

export function useLiveEvents(maxItems = 200) {
  const [events, setEvents] = useState<MediaEvent[]>([]);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [lastDigest, setLastDigest] = useState<{ eventCount: number; ranAt: number } | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const retryRef = useRef(0);

  // Only replace lastRun with something older than — or equal to — what we
  // already have; a live WS update should never get clobbered by a slower
  // history fetch racing behind it, and vice versa.
  function applyLastRun(next: LastRun) {
    setLastRun((prev) => (prev && prev.ranAt > next.ranAt ? prev : next));
  }

  useEffect(() => {
    // Seeds the failed-digest banner from what already happened before this
    // page was even open — a live WS message alone would miss a failure
    // that occurred while nobody had the app loaded.
    api
      .getDigestHistory()
      .then((history) => {
        const last = history[history.length - 1];
        if (!last) return;
        applyLastRun(
          last.status === "error"
            ? { ok: false, error: last.error ?? "Unknown error", ranAt: last.ranAt }
            : { ok: true, ranAt: last.ranAt },
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let socket: WebSocket;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${proto}//${window.location.host}/api/ws`);
      setStatus("connecting");

      socket.onopen = () => {
        retryRef.current = 0;
        setStatus("open");
      };

      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as WsMessage;
        if (msg.type === "backlog") {
          setEvents(msg.events);
        } else if (msg.type === "event") {
          setEvents((prev) => [msg.event, ...prev].slice(0, maxItems));
        } else if (msg.type === "digest_sent") {
          setLastDigest({ eventCount: msg.eventCount, ranAt: msg.ranAt });
          applyLastRun({ ok: true, ranAt: msg.ranAt });
          // Drop exactly the items this digest included, not everything —
          // an event that arrived mid-send (after the digest snapshot its
          // pending list) isn't part of it and should stay visible.
          const sentIds = new Set(msg.eventIds);
          setEvents((prev) => prev.filter((e) => !sentIds.has(e.id)));
        } else if (msg.type === "digest_error") {
          applyLastRun({ ok: false, error: msg.error, ranAt: msg.ranAt });
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        setStatus("closed");
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
        retryRef.current += 1;
        retryTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [maxItems]);

  return { events, status, lastDigest, lastRun };
}
