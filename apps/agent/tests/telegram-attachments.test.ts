import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tempRoot: string;

describe("telegram-attachments", () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "shellraining-attachments-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  it("sanitizes unsafe filenames", async () => {
    const { safeTelegramFilename } = await import("../src/runtime/telegram-attachments.js");

    expect(safeTelegramFilename("../../report.pdf", "fallback.pdf")).toBe("report.pdf");
    expect(safeTelegramFilename(" spaced name .txt ", "fallback.txt")).toBe("spaced name .txt");
    expect(safeTelegramFilename("", "../../fallback.pdf")).toBe("fallback.pdf");
    expect(safeTelegramFilename(undefined, "../../fallback.pdf")).toBe("fallback.pdf");
    expect(safeTelegramFilename("../..", "fallback.txt")).toBe("fallback.txt");
    expect(safeTelegramFilename(".", "fallback.txt")).toBe("fallback.txt");
    expect(safeTelegramFilename("/", "fallback.txt")).toBe("fallback.txt");
    expect(safeTelegramFilename(".", "..")).toBe("attachment.bin");
    expect(safeTelegramFilename("", "fallback.txt")).toBe("fallback.txt");
    expect(safeTelegramFilename(undefined, "fallback.txt")).toBe("fallback.txt");
  });

  it("saves attachments under the thread and message inbox path", async () => {
    const { saveTelegramAttachment } = await import("../src/runtime/telegram-attachments.js");

    const result = await saveTelegramAttachment({
      attachment: {
        data: Buffer.from("hello"),
        fallbackFilename: "attachment.bin",
        filename: "../../report.pdf",
        mimeType: "application/pdf",
        type: "file",
      },
      baseDir: tempRoot,
      messageId: "telegram:123:456",
      threadKey: "telegram__123__456",
    });

    expect(result.filename).toBe("report.pdf");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.type).toBe("file");
    expect(result.size).toBe(5);
    expect(result.path).toBe(
      join(tempRoot, "inbox", "telegram__123__456", "telegram_123_456", "report.pdf"),
    );
    await expect(readFile(result.path, "utf-8")).resolves.toBe("hello");
  });
});
