import { describe, expect, it } from "vitest";
import { applyErrorBackoff, computeNextRunAtMs } from "../src/cron/schedule.js";

describe("cron schedule", () => {
  it("aligns interval schedules to their anchor", () => {
    expect(
      computeNextRunAtMs(
        {
          kind: "every",
          everyMs: 15 * 60 * 1000,
          anchorMs: Date.parse("2026-04-16T09:00:00.000Z"),
        },
        Date.parse("2026-04-16T09:07:00.000Z"),
      ),
    ).toBe(Date.parse("2026-04-16T09:15:00.000Z"));
  });

  it("returns the next interval immediately when now matches an anchored boundary", () => {
    expect(
      computeNextRunAtMs(
        {
          kind: "every",
          everyMs: 15 * 60 * 1000,
          anchorMs: Date.parse("2026-04-16T09:00:00.000Z"),
        },
        Date.parse("2026-04-16T09:15:00.000Z"),
      ),
    ).toBe(Date.parse("2026-04-16T09:15:00.000Z"));
  });

  it("returns undefined for one-shot schedules in the past", () => {
    expect(
      computeNextRunAtMs(
        { kind: "at", at: "2026-04-16T08:59:59.000Z" },
        Date.parse("2026-04-16T09:00:00.000Z"),
      ),
    ).toBeUndefined();
  });

  it("computes the next cron occurrence", () => {
    expect(
      computeNextRunAtMs(
        { kind: "cron", expr: "*/5 * * * *", tz: "UTC" },
        Date.parse("2026-04-16T09:07:00.000Z"),
      ),
    ).toBe(Date.parse("2026-04-16T09:10:00.000Z"));
  });

  it("applies exponential error backoff from now", () => {
    expect(
      applyErrorBackoff(
        Date.parse("2026-04-16T09:00:05.000Z"),
        3,
        Date.parse("2026-04-16T09:00:00.000Z"),
      ),
    ).toBe(Date.parse("2026-04-16T09:04:00.000Z"));
  });

  it("does not move runs backward when the scheduled time is later than backoff", () => {
    expect(
      applyErrorBackoff(
        Date.parse("2026-04-16T09:10:00.000Z"),
        2,
        Date.parse("2026-04-16T09:00:00.000Z"),
      ),
    ).toBe(Date.parse("2026-04-16T09:10:00.000Z"));
  });
});
