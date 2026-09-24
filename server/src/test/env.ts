import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// db/client.ts opens the database the moment it's imported, so any test that
// touches the DB must import this module FIRST — otherwise it would read and
// write the real dev database in server/data.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arr-digest-test-"));
process.env.DATA_DIR = dir;

process.on("exit", () => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can refuse while SQLite still holds the file; it's a temp dir.
  }
});
