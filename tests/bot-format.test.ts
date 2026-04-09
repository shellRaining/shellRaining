import { describe, expect, it } from "vitest";
import { TELEGRAM_CONCURRENCY, shouldFallbackToRawTelegramReply, toTelegramReplyMessage } from "../src/bot.js";

describe("bot reply formatting", () => {
  it("wraps agent text as a markdown postable message", () => {
    expect(toTelegramReplyMessage("**bold** and _italic_"))
      .toEqual({ markdown: "**bold** and _italic_" });
  });

  it("falls back to raw text for Telegram entity parse errors", () => {
    const error = Object.assign(
      new Error("Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 65"),
      { code: "VALIDATION_ERROR" }
    );

    expect(shouldFallbackToRawTelegramReply(error)).toBe(true);
  });

  it("does not fallback for unrelated errors", () => {
    const error = Object.assign(new Error("network timeout"), { code: "NETWORK_ERROR" });

    expect(shouldFallbackToRawTelegramReply(error)).toBe(false);
  });
});

describe("bot concurrency", () => {
  it("uses debounce strategy for Telegram bursts", () => {
    expect(TELEGRAM_CONCURRENCY).toEqual({
      strategy: "debounce",
      debounceMs: 1200,
    });
  });
});
