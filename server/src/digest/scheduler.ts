import { Cron } from "croner";
import { getDigestTimes, getSettings } from "../config/settings.js";
import { listDestinations, scheduleByTime } from "./destinations.js";
import { runDigest } from "./service.js";

let jobs: Cron[] = [];

function stopAll() {
  for (const job of jobs) job.stop();
  jobs = [];
}

// Call whenever the main schedule or any destination changes.
export function rescheduleDigest() {
  stopAll();

  const settings = getSettings();
  // Master switch: off stops every scheduled send, custom schedules included.
  if (!settings.digestEnabled) return;

  const byTime = scheduleByTime(listDestinations(), getDigestTimes());
  for (const [time, destinationIds] of byTime) {
    const [hour, minute] = time.split(":").map(Number);
    if (Number.isNaN(hour) || Number.isNaN(minute)) continue;

    const job = new Cron(`${minute} ${hour} * * *`, { timezone: settings.timezone }, () => {
      runDigest(destinationIds).catch((err) => {
        console.error(`[digest] scheduled run at ${time} failed:`, err);
      });
    });
    jobs.push(job);
  }
}
