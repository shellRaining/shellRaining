import { describe, expect, it } from "vitest";
import type { CronJob } from "../src/cron/types.js";
import {
  findEarliestNextRunAtMs,
  MAX_TIMER_DELAY_MS,
  planTimerDelayMs,
} from "../src/cron/timer.js";

function createJob(id: string, nextRunAtMs?: number, enabled = true): CronJob {
  return {
    id,
    name: `job-${id}`,
    chatId: 1,
    threadId: "telegram:1",
    threadKey: "telegram__1",
    enabled,
    deleteAfterRun: false,
    createdAtMs: 1,
    schedule: { kind: "every", everyMs: 60_000 },
    payload: { kind: "agentTurn", message: "run" },
    state: { consecutiveErrors: 0, nextRunAtMs },
  };
}

describe("cron timer", () => {
  it("caps timer delays at sixty seconds", () => {
    expect(
      planTimerDelayMs(
        Date.parse("2026-04-16T09:02:30.000Z"),
        Date.parse("2026-04-16T09:00:00.000Z"),
      ),
    ).toBe(MAX_TIMER_DELAY_MS);
  });

  it("fires overdue work immediately", () => {
    expect(
      planTimerDelayMs(
        Date.parse("2026-04-16T08:59:59.000Z"),
        Date.parse("2026-04-16T09:00:00.000Z"),
      ),
    ).toBe(0);
  });

  it("uses the exact remaining delay when it is under the cap", () => {
    expect(
      planTimerDelayMs(
        Date.parse("2026-04-16T09:00:45.000Z"),
        Date.parse("2026-04-16T09:00:00.000Z"),
      ),
    ).toBe(45_000);
  });

  it("finds the earliest enabled next run", () => {
    expect(
      findEarliestNextRunAtMs([
        createJob("later", Date.parse("2026-04-16T09:10:00.000Z")),
        createJob("disabled", Date.parse("2026-04-16T09:01:00.000Z"), false),
        createJob("earliest", Date.parse("2026-04-16T09:05:00.000Z")),
        createJob("missing"),
      ]),
    ).toBe(Date.parse("2026-04-16T09:05:00.000Z"));
  });

  it("returns undefined when no enabled jobs are scheduled", () => {
    expect(
      findEarliestNextRunAtMs([createJob("disabled", 1, false), createJob("missing")]),
    ).toBeUndefined();
  });
});
