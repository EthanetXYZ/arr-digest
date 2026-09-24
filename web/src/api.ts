import type {
  AuthMode,
  AuthStatus,
  Destination,
  DestinationInput,
  DigestRun,
  DiscordMessage,
  MediaEvent,
  NetworkInfo,
  PreviewOverrides,
  Settings,
  VersionInfo,
} from "./types";

// Fired when the server says this browser isn't signed in (session expired,
// logged out elsewhere, password changed) — AuthContext re-checks and shows
// the login screen.
export const UNAUTHORIZED_EVENT = "arr-digest:unauthorized";

// A 401 from these means "wrong password", not "you're signed out".
const PASSWORD_CHECK_PATHS = ["/api/auth/login", "/api/auth/credentials"];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      // Required by the server on every non-GET call (CSRF guard).
      "x-requested-with": "arr-digest",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401 && !PASSWORD_CHECK_PATHS.includes(path)) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
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
  removeEvent: (id: number) =>
    request<{ ok: boolean; error?: string }>(`/api/events/${id}`, { method: "DELETE" }),
  getDigestHistory: () => request<DigestRun[]>("/api/digest/history"),
  runDigestNow: () =>
    request<{ ok: boolean; error?: string; warning?: string }>("/api/digest/run-now", { method: "POST" }),
  getNetworkInfo: () => request<NetworkInfo>("/api/system/network-info"),
  getVersion: () => request<VersionInfo>("/api/version"),
  renderDigestPreview: (settings: PreviewOverrides, destinationId?: number) =>
    request<{ messages: DiscordMessage[] }>("/api/digest/render", {
      method: "POST",
      body: JSON.stringify({ settings, sample: true, destinationId }),
    }),
  getDestinations: () => request<Destination[]>("/api/destinations"),
  createDestination: (input: DestinationInput) =>
    request<Destination>("/api/destinations", { method: "POST", body: JSON.stringify(input) }),
  updateDestination: (id: number, input: DestinationInput) =>
    request<Destination>(`/api/destinations/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteDestination: (id: number) =>
    request<{ ok: boolean }>(`/api/destinations/${id}`, { method: "DELETE" }),
  testDestination: (id: number, settings: PreviewOverrides) =>
    request<{ ok: boolean; error?: string }>(`/api/destinations/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ settings }),
    }),
  getAuthStatus: () => request<AuthStatus>("/api/auth/status"),
  setupLogin: (username: string, password: string) =>
    request<AuthStatus>("/api/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<AuthStatus>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  getWsTicket: () => request<{ ticket: string }>("/api/auth/ws-ticket", { method: "POST" }),
  updateCredentials: (input: { currentPassword: string; username: string; newPassword?: string }) =>
    request<AuthStatus>("/api/auth/credentials", { method: "PUT", body: JSON.stringify(input) }),
  setAuthMode: (mode: AuthMode) =>
    request<AuthStatus>("/api/auth/mode", { method: "PUT", body: JSON.stringify({ mode }) }),
};
