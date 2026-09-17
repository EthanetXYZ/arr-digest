import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { DigestRun, NetworkInfo, Settings as SettingsType } from "../types";

function useTimezones(): string[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [Intl.DateTimeFormat().resolvedOptions().timeZone];
  }
  // Not always present in the IANA list the runtime exposes, but it's our
  // stored default, so make sure it's always a selectable option.
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium text-slate-200">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 accent-upgrade"
      />
    </label>
  );
}

async function copyText(value: string, input: HTMLInputElement | null): Promise<boolean> {
  // navigator.clipboard only exists in a "secure context" (HTTPS, or the
  // localhost origin itself) — plain http://<lan-ip> has no such API at all,
  // so this must be feature-detected rather than just try/caught.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to the legacy path below
    }
  }

  if (input) {
    input.focus();
    input.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }

  return false;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          className="flex-1 truncate rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-300"
        />
        <button
          onClick={async () => {
            const ok = await copyText(value, inputRef.current);
            setState(ok ? "copied" : "failed");
            setTimeout(() => setState("idle"), 1500);
          }}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
        >
          {state === "copied" ? "Copied" : state === "failed" ? "Select & Ctrl+C" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [history, setHistory] = useState<DigestRun[]>([]);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timezones = useTimezones();

  useEffect(() => {
    api.getSettings().then(setSettings);
    api.getDigestHistory().then(setHistory);
    api.getNetworkInfo().then(setNetworkInfo).catch(() => {});
  }, []);

  if (!settings) {
    return <div className="mx-auto max-w-2xl px-4 py-6 text-slate-400">Loading…</div>;
  }

  function patch(p: Partial<SettingsType>) {
    setSettings((s) => (s ? { ...s, ...p } : s));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const origin = settings.publicUrl?.trim() || window.location.origin;
  const sonarrUrl = `${origin}/api/webhooks/sonarr?token=${settings.webhookToken}`;
  const radarrUrl = `${origin}/api/webhooks/radarr?token=${settings.webhookToken}`;

  const port = networkInfo?.port ?? window.location.port;
  const protocol = window.location.protocol;
  const suggestedUrls = (networkInfo?.addresses ?? []).map(
    (addr) => `${protocol}//${addr}${port ? `:${port}` : ""}`,
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-1 text-lg font-semibold text-white">Connect Sonarr / Radarr</h2>
        <p className="mb-2 text-sm text-slate-400">
          In each app, go to <span className="text-slate-300">Settings → Connect → Add → Webhook</span>,
          paste the matching URL below, set the method to <span className="text-slate-300">POST</span>,
          and enable these notification triggers:
        </p>
        <ul className="mb-4 list-disc pl-5 text-sm text-slate-400">
          <li>
            <span className="text-slate-300">On Import</span> — for new additions
          </li>
          <li>
            <span className="text-slate-300">On Upgrade</span> — required, or Sonarr/Radarr won't send us
            the event at all when a file is replaced with a better one (it's a separate trigger from{" "}
            <span className="text-slate-300">On Import</span>, not implied by it)
          </li>
          <li>
            <span className="text-slate-300">On File Delete</span> — for genuine removals.{" "}
            <span className="text-slate-300">On File Delete for Upgrade</span> is not needed — this app
            already gets upgrade info from the paired Upgrade event and ignores that one to avoid
            double-counting.
          </li>
        </ul>

        <label className="mb-1 block text-sm font-medium text-slate-200">
          Public URL <span className="font-normal text-slate-500">(how Sonarr/Radarr reach this app)</span>
        </label>
        <input
          value={settings.publicUrl ?? ""}
          onChange={(e) => patch({ publicUrl: e.target.value || null })}
          placeholder={suggestedUrls[0] ?? window.location.origin}
          className="mb-1 w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        />
        {suggestedUrls.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1 text-xs text-slate-500">
            Detected on this host:
            {suggestedUrls.map((u) => (
              <button
                key={u}
                onClick={() => patch({ publicUrl: u })}
                className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-upgrade hover:text-upgrade"
              >
                {u}
              </button>
            ))}
          </div>
        )}
        <p className="mb-4 text-xs text-slate-500">
          Leave blank to use whatever address you're viewing this page from ({window.location.origin}
          ) — but that's wrong if you're viewing it via <code>localhost</code> while Sonarr/Radarr run
          elsewhere (e.g. other Docker containers). If this app is containerized, the auto-detected
          address above may be the container's internal IP rather than the host's — prefer the host's
          LAN IP and the port you mapped it to.
        </p>

        <CopyField label="Sonarr webhook URL" value={sonarrUrl} />
        <CopyField label="Radarr webhook URL" value={radarrUrl} />
      </section>

      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Discord</h2>
        <label className="mb-1 block text-sm font-medium text-slate-200">Webhook URL</label>
        <input
          value={settings.discordWebhookUrl ?? ""}
          onChange={(e) => patch({ discordWebhookUrl: e.target.value })}
          placeholder="https://discord.com/api/webhooks/..."
          className="mb-3 w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        />
        <label className="mb-1 block text-sm font-medium text-slate-200">Mention (optional)</label>
        <input
          value={settings.mentionContent ?? ""}
          onChange={(e) => patch({ mentionContent: e.target.value })}
          placeholder="@here, @everyone, or <@&roleId>"
          className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        />
      </section>

      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Schedule</h2>
        <Toggle
          label="Enable scheduled digest"
          checked={settings.digestEnabled}
          onChange={(v) => patch({ digestEnabled: v })}
        />

        <div className="mb-1 mt-2 text-sm font-medium text-slate-200">Send times</div>
        <div className="flex flex-wrap gap-2">
          {settings.digestTimes.map((t, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="time"
                value={t}
                onChange={(e) => {
                  const next = [...settings.digestTimes];
                  next[i] = e.target.value;
                  patch({ digestTimes: next });
                }}
                className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-sm text-slate-200"
              />
              <button
                onClick={() => patch({ digestTimes: settings.digestTimes.filter((_, idx) => idx !== i) })}
                className="rounded-md px-2 py-1 text-sm text-slate-500 hover:text-removal"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => patch({ digestTimes: [...settings.digestTimes, "09:00"] })}
            className="rounded-md border border-dashed border-slate-700 px-3 py-1 text-sm text-slate-400 hover:text-slate-200"
          >
            + Add time
          </button>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium text-slate-200">Timezone</label>
          <select
            value={settings.timezone}
            onChange={(e) => patch({ timezone: e.target.value })}
            className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Digest content</h2>
        <label className="mb-1 block text-sm font-medium text-slate-200">Title</label>
        <input
          value={settings.digestTitle}
          onChange={(e) => patch({ digestTitle: e.target.value })}
          className="mb-2 w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        />
        <Toggle
          label="Group by media type"
          hint="Separate sections for TV shows and movies"
          checked={settings.groupByType}
          onChange={(v) => patch({ groupByType: v })}
        />
        <Toggle
          label="Compact mode"
          hint="One summary embed per category instead of one embed per item"
          checked={settings.compactMode}
          onChange={(v) => patch({ compactMode: v })}
        />
        <Toggle
          label="Show posters"
          hint="Only applies when compact mode is off"
          checked={settings.showPoster}
          onChange={(v) => patch({ showPoster: v })}
        />
        <Toggle
          label="Skip sending when nothing changed"
          checked={settings.skipIfEmpty}
          onChange={(v) => patch({ skipIfEmpty: v })}
        />
      </section>

      <div className="mb-8 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-upgrade px-4 py-2 text-sm font-medium text-white hover:bg-upgrade/80 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-sm text-addition">Saved.</span>}
      </div>

      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Digest history</h2>
        {history.length === 0 ? (
          <div className="text-sm text-slate-500">No digests sent yet.</div>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {history.map((run) => (
              <li key={run.id} className="flex items-center justify-between border-b border-slate-800/60 py-1">
                <span className="text-slate-400">{new Date(run.ranAt).toLocaleString()}</span>
                <span
                  className={
                    run.status === "sent"
                      ? "text-addition"
                      : run.status === "error"
                        ? "text-removal"
                        : "text-slate-500"
                  }
                >
                  {run.status === "sent"
                    ? `Sent (${run.eventCount})`
                    : run.status === "skipped_empty"
                      ? "Skipped (nothing to report)"
                      : `Error: ${run.error}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
