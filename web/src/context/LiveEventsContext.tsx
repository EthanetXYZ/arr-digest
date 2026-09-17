import { createContext, useContext, type ReactNode } from "react";
import { useLiveEvents } from "../hooks/useLiveEvents";

type LiveEventsValue = ReturnType<typeof useLiveEvents>;

const LiveEventsContext = createContext<LiveEventsValue | null>(null);

// Held at the app root (not per-page) so the WebSocket connection — and the
// pending count it drives (tab title, badge) — stays live and accurate no
// matter which page is currently showing.
export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const value = useLiveEvents();
  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}

export function useLiveEventsContext(): LiveEventsValue {
  const ctx = useContext(LiveEventsContext);
  if (!ctx) throw new Error("useLiveEventsContext must be used within LiveEventsProvider");
  return ctx;
}
