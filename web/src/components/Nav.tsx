import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import type { VersionInfo } from "../types";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
    isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
  }`;

function buildTooltip(v: VersionInfo): string {
  if (!v.builtAt) return "Local dev build (not built via Docker)";
  return `Built ${new Date(v.builtAt).toLocaleString()}`;
}

export function Nav() {
  const [version, setVersion] = useState<VersionInfo | null>(null);

  useEffect(() => {
    api.getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
        <span className="mr-2 text-lg font-semibold text-white">Arr Digest</span>
        <nav className="flex gap-1">
          <NavLink to="/" end className={linkClass}>
            Live Feed
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            Settings
          </NavLink>
        </nav>
        {version && (
          <span
            title={buildTooltip(version)}
            className="ml-auto rounded border border-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-500"
          >
            {version.commit}
          </span>
        )}
      </div>
    </header>
  );
}
