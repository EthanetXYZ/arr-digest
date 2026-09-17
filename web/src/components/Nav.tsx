import { NavLink } from "react-router-dom";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
    isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
  }`;

export function Nav() {
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
      </div>
    </header>
  );
}
