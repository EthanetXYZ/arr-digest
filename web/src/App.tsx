import { useEffect, useMemo } from "react";
import { Route, Routes } from "react-router-dom";
import { Nav } from "./components/Nav";
import { Footer } from "./components/Footer";
import { AuthScreen } from "./components/AuthScreen";
import { LiveFeed } from "./pages/LiveFeed";
import { Settings } from "./pages/Settings";
import { AuthGate } from "./context/AuthContext";
import { LiveEventsProvider, useLiveEventsContext } from "./context/LiveEventsContext";
import { groupLiveEvents } from "./lib/groupEvents";

function TitleUpdater() {
  const { events } = useLiveEventsContext();
  // Same count as the Live Feed: a season batch is one item.
  const count = useMemo(() => groupLiveEvents(events).length, [events]);

  useEffect(() => {
    document.title = count > 0 ? `(${count}) Arr Digest` : "Arr Digest";
    return () => {
      document.title = "Arr Digest";
    };
  }, [count]);

  return null;
}

export function App() {
  return (
    <AuthGate signedOut={(status, setStatus) => <AuthScreen status={status} onSignedIn={setStatus} />}>
      <LiveEventsProvider>
        <TitleUpdater />
        {/* Column layout so the footer sits at the bottom of the window
            even when a page is short. */}
        <div className="flex min-h-screen flex-col">
          <Nav />
          <main className="w-full">
            <Routes>
              <Route path="/" element={<LiveFeed />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </LiveEventsProvider>
    </AuthGate>
  );
}
