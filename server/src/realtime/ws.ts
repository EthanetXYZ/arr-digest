import type { WebSocket } from "ws";

const clients = new Set<WebSocket>();

export function registerClient(socket: WebSocket) {
  clients.add(socket);
  socket.on("close", () => clients.delete(socket));
}

export function broadcast(event: unknown) {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}
