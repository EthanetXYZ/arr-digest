import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface VersionInfo {
  commit: string;
  builtAt: string | null;
}

let cached: VersionInfo | null = null;

// In Docker this reads the version.json the build stamped with the actual
// commit that was built (see Dockerfile) — the only reliable way to tell
// whether an Unraid rebuild actually picked up new code, since "I rebuilt
// it" and "it rebuilt the commit I think it did" aren't the same claim.
// In local dev (no version.json) it falls back to asking git directly.
export function getVersionInfo(): VersionInfo {
  if (cached) return cached;

  for (const candidate of [
    path.join(process.cwd(), "version.json"),
    path.join(process.cwd(), "..", "version.json"),
  ]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (parsed.commit) {
        cached = { commit: parsed.commit, builtAt: parsed.builtAt ?? null };
        return cached;
      }
    } catch {
      // try the next candidate / fall through to git below
    }
  }

  try {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: path.join(process.cwd(), ".."),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    cached = { commit: `${commit}-dev`, builtAt: null };
    return cached;
  } catch {
    cached = { commit: "unknown", builtAt: null };
    return cached;
  }
}
