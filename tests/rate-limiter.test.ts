import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, resetRateLimitForTesting } from "../src/runtime/rate-limiter.js";

describe("rate-limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRateLimitForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first request", () => {
    const result = checkRateLimit(123, 5000);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBeUndefined();
  });

  it("blocks request within cooldown period", () => {
    checkRateLimit(123, 5000);
    vi.advanceTimersByTime(2000);
    const result = checkRateLimit(123, 5000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(3000);
  });

  it("tracks different chats independently", () => {
    checkRateLimit(123, 5000);
    const result = checkRateLimit(456, 5000);
    expect(result.allowed).toBe(true);
  });
});
