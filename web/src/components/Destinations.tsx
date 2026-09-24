import { useEffect, useState } from "react";
import { api } from "../api";
import type { Destination, DestinationInput, PreviewOverrides } from "../types";

const EMPTY: DestinationInput = {
  name: "",
  webhookUrl: "",
  enabled: true,
  mode: "digest",
  includeAdditions: true,
  includeUpgrades: true,
  includeRemovals: true,
  includeMovies: true,
  includeSeries: true,
  mentionContent: null,
};

function toInput(d: Destination): DestinationInput {
  const { id: _id, createdAt: _createdAt, ...input } = d;
  return input;
}

function Chip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-0.5 text-xs font-medium transition ${
        active ? color : "border-slate-800 text-slate-600 line-through hover:text-slate-400"
      }`}
    >
      {label}
    </button>
  );
}

function DestinationCard({
  saved,
  formatOverrides,
  onSaved,
  onDeleted,
}: {
  saved: Destination | null;
  formatOverrides: PreviewOverrides;
  onSaved: (d: Destination) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<DestinationInput>(saved ? toInput(saved) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const dirty = !saved || JSON.stringify(toInput(saved)) !== JSON.stringify(draft);
  const patch = (p: Partial<DestinationInput>) => setDraft((d) => ({ ...d, ...p }));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = saved
        ? await api.updateDestination(saved.id, draft)
        : await api.createDestination(draft);
      setDraft(toInput(result));
      onSaved(result);
      setMessage({ ok: true, text: "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Failed to save." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!saved) return onDeleted();
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try {
      await api.deleteDestination(saved.id);
      onDeleted();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Failed to delete." });
      setBusy(false);
    }
  }

  async function test() {
    if (!saved) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.testDestination(saved.id, formatOverrides);
      setMessage({ ok: true, text: "Test sent — check the channel." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Failed to send." });
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200";

  return (
    <div
      className={`rounded-lg border p-3 ${
        draft.enabled ? "border-slate-700 bg-slate-950/40" : "border-slate-800 bg-slate-950/20 opacity-70"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Name, e.g. #new-stuff"
          className={`${input} flex-1 font-medium`}
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="h-4 w-4 accent-upgrade"
          />
          Enabled
        </label>
      </div>

      <input
        value={draft.webhookUrl}
        onChange={(e) => patch({ webhookUrl: e.target.value })}
        placeholder="https://discord.com/api/webhooks/..."
        className={`${input} mb-2`}
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Delivery:</span>
        <div className="inline-flex rounded-md border border-slate-800 p-0.5">
          {(["digest", "instant"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => patch({ mode })}
              className={`rounded px-2.5 py-0.5 text-xs font-medium transition ${
                draft.mode === mode ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {mode === "digest" ? "Scheduled digest" : "Instant"}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">
          {draft.mode === "digest"
            ? "Sent at the digest times on the Schedule tab."
            : "Sent ~20s after events arrive, so a season drop still lands as one message."}
        </span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-slate-500">Events:</span>
        <Chip
          label="Added"
          active={draft.includeAdditions}
          color="border-addition/40 bg-addition/10 text-addition"
          onClick={() => patch({ includeAdditions: !draft.includeAdditions })}
        />
        <Chip
          label="Upgraded"
          active={draft.includeUpgrades}
          color="border-upgrade/40 bg-upgrade/10 text-upgrade"
          onClick={() => patch({ includeUpgrades: !draft.includeUpgrades })}
        />
        <Chip
          label="Removed"
          active={draft.includeRemovals}
          color="border-removal/40 bg-removal/10 text-removal"
          onClick={() => patch({ includeRemovals: !draft.includeRemovals })}
        />
        <span className="ml-3 mr-1 text-xs text-slate-500">Media:</span>
        <Chip
          label="Movies"
          active={draft.includeMovies}
          color="border-slate-500 bg-slate-800 text-slate-200"
          onClick={() => patch({ includeMovies: !draft.includeMovies })}
        />
        <Chip
          label="TV"
          active={draft.includeSeries}
          color="border-slate-500 bg-slate-800 text-slate-200"
          onClick={() => patch({ includeSeries: !draft.includeSeries })}
        />
      </div>

      <input
        value={draft.mentionContent ?? ""}
        onChange={(e) => patch({ mentionContent: e.target.value || null })}
        placeholder="Mention (optional): @here, @everyone, or <@&roleId>"
        className={`${input} mb-2`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-md bg-upgrade px-3 py-1 text-sm font-medium text-white hover:bg-upgrade/80 disabled:opacity-40"
        >
          {saved ? "Save" : "Create"}
        </button>
        <button
          onClick={test}
          disabled={busy || !saved || dirty}
          title={!saved || dirty ? "Save first — the test uses the saved destination" : undefined}
          className="rounded-md bg-slate-800 px-3 py-1 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40"
        >
          Send test
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className={`ml-auto rounded-md px-3 py-1 text-sm transition ${
            confirmDelete ? "bg-removal/20 text-removal" : "text-slate-500 hover:text-removal"
          }`}
        >
          {!saved ? "Discard" : confirmDelete ? "Confirm delete?" : "Delete"}
        </button>
        {message && (
          <span className={`w-full text-xs ${message.ok ? "text-addition" : "text-removal"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

export function Destinations({
  destinations,
  onChange,
  formatOverrides,
}: {
  destinations: Destination[];
  onChange: (next: Destination[]) => void;
  formatOverrides: PreviewOverrides;
}) {
  const [drafts, setDrafts] = useState<number[]>([]);
  const [nextDraftKey, setNextDraftKey] = useState(0);

  const enabled = destinations.filter((d) => d.enabled);
  const uncovered = [
    { label: "Added", on: enabled.some((d) => d.includeAdditions) },
    { label: "Upgraded", on: enabled.some((d) => d.includeUpgrades) },
    { label: "Removed", on: enabled.some((d) => d.includeRemovals) },
  ]
    .filter((k) => !k.on)
    .map((k) => k.label);

  return (
    <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="mb-1 text-lg font-semibold text-white">Discord destinations</h2>
      <p className="mb-3 text-sm text-slate-400">
        Each destination is a Discord webhook that receives only the events you pick — e.g. upgrades to
        one channel and removals to another. Events no destination picks up are simply not sent.
      </p>

      <div className="flex flex-col gap-3">
        {destinations.map((d) => (
          <DestinationCard
            key={d.id}
            saved={d}
            formatOverrides={formatOverrides}
            onSaved={(updated) => onChange(destinations.map((x) => (x.id === updated.id ? updated : x)))}
            onDeleted={() => onChange(destinations.filter((x) => x.id !== d.id))}
          />
        ))}
        {drafts.map((key) => (
          <DestinationCard
            key={`draft-${key}`}
            saved={null}
            formatOverrides={formatOverrides}
            onSaved={(created) => {
              setDrafts((ds) => ds.filter((k) => k !== key));
              onChange([...destinations, created]);
            }}
            onDeleted={() => setDrafts((ds) => ds.filter((k) => k !== key))}
          />
        ))}
      </div>

      <button
        onClick={() => {
          setDrafts((ds) => [...ds, nextDraftKey]);
          setNextDraftKey((k) => k + 1);
        }}
        className="mt-3 rounded-md border border-dashed border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        + Add destination
      </button>

      {destinations.length === 0 ? (
        <p className="mt-3 text-sm text-removal">No destinations yet — digests have nowhere to go.</p>
      ) : (
        uncovered.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Not sent anywhere: <span className="text-slate-300">{uncovered.join(", ")}</span>
          </p>
        )
      )}
    </section>
  );
}
