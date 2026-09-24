import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { Nav } from "./components/Nav";
import { AuthScreen } from "./components/AuthScreen";
import { LiveFeed } from "./pages/LiveFeed";
import { Settings } from "./pages/Settings";
import { AuthGate } from "./context/AuthContext";
import { LiveEventsProvider, useLiveEventsContext } from "./context/LiveEventsContext";

function TitleUpdater() {
  const { events } = useLiveEventsContext();

  useEffect(() => {
    document.title = events.length > 0 ? `(${events.length}) Arr Digest` : "Arr Digest";
    return () => {
      document.title = "Arr Digest";
    };
  }, [events.length]);

  return null;
}

export function App() {
  return (
    <AuthGate signedOut={(status, setStatus) => <AuthScreen status={status} onSignedIn={setStatus} />}>
      <LiveEventsProvider>
        <TitleUpdater />
        <div className="min-h-screen">
          <Nav />
          <Routes>
            <Route path="/" element={<LiveFeed />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </LiveEventsProvider>
    </AuthGate>
  );
}
