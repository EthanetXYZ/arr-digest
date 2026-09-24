import type { WebSocket } from "ws";

// Session each socket was opened under (null = local-network bypass), so
// logging out or changing the password can close the live feeds it opened.
const clients = new Map<WebSocket, string | null>();

export function registerClient(socket: WebSocket, sessionHash: string | null) {
  clients.set(socket, sessionHash);
  socket.on("close", () => clients.delete(socket));
}

export function closeClients(match: (sessionHash: string | null) => boolean) {
  for (const [socket, sessionHash] of clients) {
    // 4001: app-defined "no longer authorised" — the page re-checks login.
    if (match(sessionHash)) socket.close(4001, "unauthorized");
  }
}

export function broadcast(event: unknown) {
  const payload = JSON.stringify(event);
  for (const client of clients.keys()) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}
