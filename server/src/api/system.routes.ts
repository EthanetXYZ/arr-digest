import os from "node:os";
import type { FastifyInstance } from "fastify";
import { sqlite } from "../db/client.js";

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
  app.get("/api/health", async (_req, reply) => {
    try {
      sqlite.prepare("SELECT 1").get();
      return { status: "ok", uptime: process.uptime() };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return reply.code(503).send({ status: "error", error });
    }
  });

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
