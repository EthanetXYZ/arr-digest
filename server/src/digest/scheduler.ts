import { Cron } from "croner";
import { getDigestTimes, getSettings } from "../config/settings.js";
import { runDigest } from "./service.js";

let jobs: Cron[] = [];

function stopAll() {
  for (const job of jobs) job.stop();
  jobs = [];
}

export function rescheduleDigest() {
  stopAll();

  const settings = getSettings();
  if (!settings.digestEnabled) return;

  const times = getDigestTimes();
  for (const time of times) {
    const [hour, minute] = time.split(":").map(Number);
    if (Number.isNaN(hour) || Number.isNaN(minute)) continue;

    const job = new Cron(
      `${minute} ${hour} * * *`,
      { timezone: settings.timezone },
      () => {
        runDigest().catch((err) => {
          console.error("[digest] scheduled run failed:", err);
        });
      },
    );
    jobs.push(job);
  }
}
