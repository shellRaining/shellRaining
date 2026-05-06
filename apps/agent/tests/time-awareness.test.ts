import { describe, expect, it } from "vitest";
import {
  appendCurrentTimeLine,
  injectPromptTimestampPrefix,
} from "../src/runtime/time-awareness.js";

describe("time-awareness helper", () => {
  it("uses the runtime environment timezone when no timezone is provided", () => {
    expect(
      injectPromptTimestampPrefix("hello", {
        nowMs: Date.parse("2026-05-06T00:49:00.000Z"),
      }),
    ).not.toBe("[Wed 2026-05-06 00:49 UTC] hello");
  });

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
