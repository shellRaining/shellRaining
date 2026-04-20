import { describe, expect, it } from "vitest";
import {
  appendCurrentTimeLine,
  injectPromptTimestampPrefix,
} from "../src/runtime/time-awareness.js";

describe("time-awareness helper", () => {
  it("falls back to UTC when prefix timezone is invalid", () => {
    expect(
      injectPromptTimestampPrefix("hello", {
        nowMs: Date.parse("2026-04-16T09:00:00.000Z"),
        timeZone: "Mars/Olympus",
      }),
    ).toBe("[Thu 2026-04-16 09:00 UTC] hello");
  });

  it("falls back to UTC when current-time timezone is invalid", () => {
    expect(
      appendCurrentTimeLine("hello", {
        nowMs: Date.parse("2026-04-16T09:00:00.000Z"),
        timeZone: "Mars/Olympus",
      }),
    ).toBe("hello\nCurrent time: Thu 2026-04-16 09:00 UTC / 2026-04-16 09:00 UTC");
  });
});
