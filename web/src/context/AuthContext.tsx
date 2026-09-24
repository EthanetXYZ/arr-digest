import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, UNAUTHORIZED_EVENT } from "../api";
import type { AuthStatus } from "../types";

type SignedIn = Extract<AuthStatus, { authenticated: true }>;

interface AuthValue {
  status: SignedIn;
  setStatus: (status: AuthStatus) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

// Renders children only once signed in; otherwise the login (or first-run
// setup) screen. Anything below can assume a valid session.
export function AuthGate({
  children,
  signedOut,
}: {
  children: ReactNode;
  signedOut: (status: AuthStatus, setStatus: (s: AuthStatus) => void) => ReactNode;
}) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const refresh = useCallback(() => {
    api
      .getAuthStatus()
      .then((s) => {
        setUnreachable(false);
        setStatus(s);
      })
      .catch(() => setUnreachable(true));
  }, []);

  useEffect(refresh, [refresh]);

  // Any API call that comes back 401 means the session is gone.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, refresh);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, refresh);
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    refresh();
  }, [refresh]);

  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-sm text-slate-400">
        {unreachable ? (
          <span>
            Can't reach the Arr Digest server.{" "}
            <button onClick={refresh} className="text-upgrade hover:underline">
              Retry
            </button>
          </span>
        ) : (
          "Loading…"
        )}
      </div>
    );
  }

  if (!status.authenticated) return <>{signedOut(status, setStatus)}</>;

  return <AuthContext.Provider value={{ status, setStatus, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthGate");
  return ctx;
}
