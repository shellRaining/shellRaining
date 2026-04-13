import { describe, expect, it } from "vitest";
import { isTelegramInputProcessable } from "../src/bot.js";

describe("bot telegram input routing", () => {
  it("treats pure attachment input as processable", () => {
    expect(isTelegramInputProcessable({
      images: [],
      isProcessable: true,
      savedFiles: [{
        filename: "report.pdf",
        mimeType: "application/pdf",
        path: "/tmp/report.pdf",
        size: 10,
        type: "file",
      }],
      text: "[Telegram attachments]\n- report.pdf: /tmp/report.pdf",
      warnings: [],
    })).toBe(true);
  });

  it("treats empty normalized input as not processable", () => {
    expect(isTelegramInputProcessable({
      images: [],
      isProcessable: false,
      savedFiles: [],
      text: "",
      warnings: [],
    })).toBe(false);
  });
});
