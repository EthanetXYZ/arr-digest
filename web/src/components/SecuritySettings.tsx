import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import type { AuthMode } from "../types";

const inputClass =
  "w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200";

const MODES: { mode: AuthMode; label: string; hint: string }[] = [
  {
    mode: "required",
    label: "Always require login",
    hint: "Recommended, and the only safe choice if this is reachable from outside your home.",
  },
  {
    mode: "local_bypass",
    label: "Not required on my local network",
    hint:
      "Devices on your LAN (192.168.x.x, 10.x.x.x, …) get straight in. Anything arriving through a " +
      "reverse proxy or tunnel still has to log in, even if the proxy itself is on your LAN.",
  },
];

function AccessMode() {
  const { status, setStatus } = useAuth();
  const [saving, setSaving] = useState<AuthMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(mode: AuthMode) {
    if (mode === status.mode) return;
    setSaving(mode);
    setError(null);
    try {
      setStatus(await api.setAuthMode(mode));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mb-5">
      <div className="mb-2 text-sm font-medium text-slate-200">Who needs to log in</div>
      <div role="radiogroup" className="flex flex-col gap-2">
        {MODES.map(({ mode, label, hint }) => (
          <label
            key={mode}
            className={`flex cursor-pointer gap-3 rounded-md border p-3 transition ${
              status.mode === mode ? "border-upgrade/60 bg-upgrade/10" : "border-slate-800 hover:border-slate-700"
            }`}
          >
            <input
              type="radio"
              name="auth-mode"
              checked={status.mode === mode}
              disabled={saving !== null}
              onChange={() => choose(mode)}
              className="mt-0.5 h-4 w-4 accent-upgrade"
            />
            <span>
              <span className="block text-sm font-medium text-slate-200">
                {label}
                {saving === mode && <span className="ml-2 text-xs font-normal text-slate-500">Saving…</span>}
              </span>
              <span className="block text-xs text-slate-500">{hint}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {status.localNetwork
          ? "This browser is connecting from your local network."
          : "This browser isn't connecting directly from your local network (or it's coming through a proxy), so it would still need to log in."}
      </p>
      {error && <p className="mt-2 text-sm text-removal">{error}</p>}
    </div>
  );
}

function ChangeLogin() {
  const { status, setStatus } = useAuth();
  const [username, setUsername] = useState(status.username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const changingPassword = newPassword !== "";
  const unchanged = username.trim() === status.username && !changingPassword;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (changingPassword && newPassword !== confirm) {
      setMessage({ ok: false, text: "New passwords don't match" });
      return;
    }
    setBusy(true);
    try {
      const next = await api.updateCredentials({
        currentPassword,
        username: username.trim(),
        ...(changingPassword ? { newPassword } : {}),
      });
      setStatus(next);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setMessage({
        ok: true,
        text: changingPassword ? "Login updated. Other browsers have been signed out." : "Username updated.",
      });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Couldn't update" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="text-sm font-medium text-slate-200">Change username or password</div>
      <label className="block">
        <span className="mb-1 block text-xs text-slate-400">Username</span>
        <input
          autoComplete="username"
          required
          maxLength={64}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClass}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            placeholder="Leave blank to keep"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            disabled={!changingPassword}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`${inputClass} disabled:opacity-40`}
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-slate-400">Current password (required to save)</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputClass}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || unchanged}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Update login"}
        </button>
        {message && (
          <span role="status" className={`text-sm ${message.ok ? "text-addition" : "text-removal"}`}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}

export function SecuritySettings() {
  const { status } = useAuth();
  return (
    <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="mb-1 text-lg font-semibold text-white">Security</h2>
      <p className="mb-4 text-sm text-slate-400">
        {status.bypassed
          ? `You're in without logging in because you're on your local network. The login is "${status.username}".`
          : `Signed in as ${status.username}.`}
      </p>
      <AccessMode />
      <ChangeLogin />
      <p className="mt-4 text-xs text-slate-500">
        Forgot the password? Run <code className="text-slate-400">docker exec arr-digest node server/dist/cli/reset-auth.js</code>{" "}
        on the Docker host, then open this page to create a new login.
      </p>
    </section>
  );
}
