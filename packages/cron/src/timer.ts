import type { CronJob } from "./types.js";

export const MAX_TIMER_DELAY_MS = 60_000;

export function planTimerDelayMs(nextRunAtMs: number, nowMs: number): number {
  if (nextRunAtMs <= nowMs) {
    return 0;
  }

  return Math.min(nextRunAtMs - nowMs, MAX_TIMER_DELAY_MS);
}

export function findEarliestNextRunAtMs(jobs: CronJob[]): number | undefined {
  let earliestNextRunAtMs: number | undefined;

  for (const job of jobs) {
    if (!job.enabled || job.state.nextRunAtMs === undefined) {
      continue;
    }

    if (earliestNextRunAtMs === undefined || job.state.nextRunAtMs < earliestNextRunAtMs) {
      earliestNextRunAtMs = job.state.nextRunAtMs;
    }
  }

  return earliestNextRunAtMs;
}
