import { describe, expect, it } from "vitest";
import {
  formatTelegramStatusMessage,
  hasPotentialTelegramInput,
  isTelegramInputProcessable,
} from "../src/bot.js";

describe("bot telegram input routing", () => {
  it("treats whitespace-only messages with no attachment or sticker as lacking potential input", () => {
    expect(hasPotentialTelegramInput({
      id: "m1",
      text: "   \n\t  ",
    })).toBe(false);
  });

  it("treats attachment input as potential input", () => {
    expect(hasPotentialTelegramInput({
      attachments: [{
        data: Buffer.from("pdf"),
        mimeType: "application/pdf",
        name: "report.pdf",
        size: 3,
        type: "file",
      }],
      id: "m2",
      text: "",
    })).toBe(true);
  });

  it("treats sticker input as potential input", () => {
    expect(hasPotentialTelegramInput({
      id: "m3",
      raw: { sticker: {} },
      text: "",
    })).toBe(true);
  });

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

  it("includes the configured Telegram API endpoint in status output", () => {
    expect(formatTelegramStatusMessage({
      skillsDir: "/skills",
      telegramApiBaseUrl: "http://127.0.0.1:8090",
      threadId: "telegram:1",
      workspace: "/workspace",
    })).toContain("telegramApi=http://127.0.0.1:8090");
  });
});
