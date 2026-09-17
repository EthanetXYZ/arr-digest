import { bootstrapDb } from "./db/bootstrap.js";
import { buildApp } from "./app.js";
import { rescheduleDigest } from "./digest/scheduler.js";

async function main() {
  bootstrapDb();

  const app = await buildApp();
  rescheduleDigest();

  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
