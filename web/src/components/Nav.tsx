import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import type { VersionInfo } from "../types";
import { useAuth } from "../context/AuthContext";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition sm:px-3 ${
    isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
  }`;

function buildTooltip(v: VersionInfo): string {
  if (!v.builtAt) return "Local dev build (not built via Docker)";
  return `Built ${new Date(v.builtAt).toLocaleString()}`;
}

export function Nav() {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const { status, logout } = useAuth();

  useEffect(() => {
    api.getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
        <span className="mr-1 whitespace-nowrap text-lg font-semibold text-white sm:mr-2">Arr Digest</span>
        <nav className="flex gap-1">
          <NavLink to="/" end className={linkClass}>
            Live Feed
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            Settings
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {version && (
            <span
              title={buildTooltip(version)}
              className="whitespace-nowrap rounded border border-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-500"
            >
              v{version.version}
              {/* Too wide for a phone nav; the tooltip still has the build time. */}
              <span className="hidden sm:inline"> · {version.commit}</span>
            </span>
          )}
          {/* Nothing to sign out of when let in by the local-network rule. */}
          {!status.bypassed && (
            <button
              onClick={logout}
              title={`Sign out ${status.username}`}
              aria-label="Sign out"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
                <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" strokeLinecap="round" />
                <path d="M12 6.5 15.5 10 12 13.5M15.5 10H8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
