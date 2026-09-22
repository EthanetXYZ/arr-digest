import type {
  DigestRun,
  DiscordMessage,
  MediaEvent,
  NetworkInfo,
  PreviewOverrides,
  Settings,
  VersionInfo,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSettings: () => request<Settings>("/api/settings"),
  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  getRecentEvents: (limit = 100) => request<MediaEvent[]>(`/api/events/recent?limit=${limit}`),
  getPendingEvents: () => request<MediaEvent[]>("/api/events/pending"),
  getDigestHistory: () => request<DigestRun[]>("/api/digest/history"),
  runDigestNow: () => request<{ ok: boolean; error?: string }>("/api/digest/run-now", { method: "POST" }),
  getNetworkInfo: () => request<NetworkInfo>("/api/system/network-info"),
  getVersion: () => request<VersionInfo>("/api/version"),
  renderDigestPreview: (settings: PreviewOverrides, sample = true) =>
    request<{ messages: DiscordMessage[] }>("/api/digest/render", {
      method: "POST",
      body: JSON.stringify({ settings, sample }),
    }),
  sendTestDigest: (settings: PreviewOverrides) =>
    request<{ ok: boolean; error?: string }>("/api/digest/send-test", {
      method: "POST",
      body: JSON.stringify({ settings }),
    }),
};
