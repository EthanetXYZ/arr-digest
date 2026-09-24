import http from "node:http";
import type { AddressInfo } from "node:net";
import type { DiscordMessage } from "../digest/builder.js";

export interface Received {
  path: string;
  body: DiscordMessage;
}

// A stand-in for Discord's webhook endpoint that records what it's sent, so
// tests can assert on routing without touching real Discord.
export async function startMockDiscord() {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received.push({ path: req.url ?? "", body: JSON.parse(raw) });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    received,
    url: (path: string) => `http://127.0.0.1:${port}/${path}`,
    to: (path: string) => received.filter((r) => r.path === `/${path}`),
    // Resolves once `count` messages have arrived (or rejects after timeoutMs).
    async waitFor(count: number, timeoutMs = 3000) {
      const start = Date.now();
      while (received.length < count) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`expected ${count} message(s), got ${received.length}`);
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Nothing listens on port 1, so sends to this fail with a connection error.
export const UNREACHABLE_URL = "http://127.0.0.1:1/unreachable";
