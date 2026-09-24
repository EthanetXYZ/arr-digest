import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { AuthStatus } from "../types";

const inputClass =
  "w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-upgrade focus:outline-none";

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-300">{label}</span>
      <input {...props} className={inputClass} />
    </label>
  );
}

// First-run "create a login" when setupRequired, otherwise the sign-in form.
export function AuthScreen({
  status,
  onSignedIn,
}: {
  status: AuthStatus;
  onSignedIn: (status: AuthStatus) => void;
}) {
  const setup = status.setupRequired;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (setup && password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      onSignedIn(setup ? await api.setupLogin(username, password) : await api.login(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/favicon.svg" alt="" className="h-12 w-12" />
          <h1 className="text-xl font-semibold text-white">{setup ? "Create your login" : "Sign in to Arr Digest"}</h1>
          {setup && (
            <p className="text-sm text-slate-400">
              This protects the dashboard and your Discord webhook settings. Sonarr and Radarr keep sending
              events without it.
            </p>
          )}
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5"
        >
          <Field
            label="Username"
            autoComplete="username"
            autoFocus
            required
            maxLength={64}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Field
            label="Password"
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            required
            minLength={setup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {setup && (
            <Field
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
          {setup && <p className="-mt-2 text-xs text-slate-500">At least 8 characters.</p>}

          {error && (
            <div role="alert" className="rounded-md border border-removal/40 bg-removal/10 px-3 py-2 text-sm text-removal">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-upgrade px-4 py-2 text-sm font-medium text-white hover:bg-upgrade/80 disabled:opacity-50"
          >
            {busy ? (setup ? "Creating…" : "Signing in…") : setup ? "Create login" : "Sign in"}
          </button>
        </form>

        {!setup && (
          <p className="mt-4 text-center text-xs text-slate-500">
            Forgot it? See "Forgot your password" in the README.
          </p>
        )}
      </div>
    </div>
  );
}
