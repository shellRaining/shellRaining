import { Cron } from "croner";
import type { CronSchedule } from "./types.js";

const ERROR_BACKOFF_BASE_MS = 60_000;

export function computeNextRunAtMs(schedule: CronSchedule, nowMs: number): number | undefined {
  if (schedule.kind === "at") {
    const atMs = Date.parse(schedule.at);
    if (!Number.isFinite(atMs) || atMs < nowMs) {
      return undefined;
    }
    return atMs;
  }

  if (schedule.kind === "every") {
    if (!Number.isFinite(schedule.everyMs) || schedule.everyMs <= 0) {
      return undefined;
    }

    const anchorMs = schedule.anchorMs ?? nowMs;
    if (nowMs <= anchorMs) {
      return anchorMs;
    }

    const elapsedIntervals = Math.ceil((nowMs - anchorMs) / schedule.everyMs);
    return anchorMs + elapsedIntervals * schedule.everyMs;
  }

  const cron = new Cron(schedule.expr, {
    paused: true,
    timezone: schedule.tz,
  });
  const nextRun = cron.nextRun(new Date(nowMs));
  return nextRun?.getTime();
}

export function applyErrorBackoff(
  nextRunAtMs: number | undefined,
  consecutiveErrors: number,
  nowMs: number,
): number | undefined {
  if (nextRunAtMs === undefined) {
    return undefined;
  }

  if (consecutiveErrors <= 0) {
    return nextRunAtMs;
  }

  const backoffDelayMs = ERROR_BACKOFF_BASE_MS * 2 ** (consecutiveErrors - 1);
  return Math.max(nextRunAtMs, nowMs + backoffDelayMs);
}
