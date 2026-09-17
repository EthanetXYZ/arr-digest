import { Route, Routes } from "react-router-dom";
import { Nav } from "./components/Nav";
import { LiveFeed } from "./pages/LiveFeed";
import { Settings } from "./pages/Settings";

export function App() {
  return (
    <div className="min-h-screen">
      <Nav />
      <Routes>
        <Route path="/" element={<LiveFeed />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </div>
  );
}
