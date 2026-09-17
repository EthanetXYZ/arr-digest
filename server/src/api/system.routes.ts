import os from "node:os";
import type { FastifyInstance } from "fastify";

function detectLanAddresses(): string[] {
  const results: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        results.push(addr.address);
      }
    }
  }
  return results;
}

export async function systemRoutes(app: FastifyInstance) {
  app.get("/api/system/network-info", async (req) => {
    // Best-effort candidates for the "reachable from other containers/hosts"
    // address — the browser's own origin is often just "localhost".
    const hostHeader = req.headers.host ?? "";
    const port = hostHeader.includes(":") ? hostHeader.split(":").pop() : undefined;
    return {
      addresses: detectLanAddresses(),
      port: port ?? null,
    };
  });
}
