import { useEffect, useRef, useState } from "react";
import type { MediaEvent, WsMessage } from "../types";

export type ConnectionState = "connecting" | "open" | "closed";

export function useLiveEvents(maxItems = 200) {
  const [events, setEvents] = useState<MediaEvent[]>([]);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [lastDigest, setLastDigest] = useState<{ eventCount: number; ranAt: number } | null>(null);
  const retryRef = useRef(0);

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
          setEvents((prev) => prev.map((e) => ({ ...e, digested: true })));
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

  return { events, status, lastDigest };
}
