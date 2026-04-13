import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Attachment } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempRoot: string;

function attachment(
  input: Partial<Attachment> & { data: Buffer; type: Attachment["type"] },
): Attachment {
  return {
    data: input.data,
    fetchData: input.fetchData,
    height: input.height,
    mimeType: input.mimeType,
    name: input.name,
    size: input.size,
    type: input.type,
    url: input.url,
    width: input.width,
  };
}

describe("telegram-input", () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "shellraining-input-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempRoot, { force: true, recursive: true });
  });

  it("preserves text and sticker emoji", async () => {
    const { normalizeTelegramInput } =
      await import("../src/runtime/telegram-input.js");

    const result = await normalizeTelegramInput({
      baseDir: tempRoot,
      message: {
        id: "m1",
        raw: { sticker: { emoji: "🙂" } },
        text: "hello 😀",
      },
      sttConfig: {},
      threadKey: "telegram__1",
    });

    expect(result.text).toContain("hello 😀");
    expect(result.text).toContain("[Telegram sticker: emoji=🙂]");
    expect(result.images).toEqual([]);
    expect(result.savedFiles).toEqual([]);
  });

  it("turns image attachments into Pi image blocks and saved file references", async () => {
    const { normalizeTelegramInput } =
      await import("../src/runtime/telegram-input.js");

    const result = await normalizeTelegramInput({
      baseDir: tempRoot,
      message: {
        attachments: [
          attachment({
            data: Buffer.from("image-data"),
            mimeType: "image/png",
            name: "photo.png",
            type: "image",
          }),
        ],
        id: "m2",
        text: "what is this?",
      },
      sttConfig: {},
      threadKey: "telegram__1",
    });

    expect(result.text).toContain("what is this?");
    expect(result.text).toContain("[Telegram image:");
    expect(result.images).toEqual([
      {
        type: "image",
        data: Buffer.from("image-data").toString("base64"),
        mimeType: "image/png",
      },
    ]);
    expect(result.savedFiles[0]?.filename).toBe("photo.png");
  });

  it("keeps document attachments as file paths without parsing contents", async () => {
    const { normalizeTelegramInput } =
      await import("../src/runtime/telegram-input.js");

    const result = await normalizeTelegramInput({
      baseDir: tempRoot,
      message: {
        attachments: [
          attachment({
            data: Buffer.from("not parsed"),
            mimeType: "application/pdf",
            name: "report.pdf",
            type: "file",
          }),
        ],
        id: "m3",
        text: "summarize this",
      },
      sttConfig: {},
      threadKey: "telegram__1",
    });

    expect(result.text).toContain("[Telegram attachments]");
    expect(result.text).toContain("report.pdf (application/pdf):");
    expect(result.text).not.toContain("not parsed");
    expect(result.images).toEqual([]);
  });

  it("adds STT transcript for audio when the transcriber succeeds", async () => {
    const { normalizeTelegramInput } =
      await import("../src/runtime/telegram-input.js");
    const transcribe = vi.fn().mockResolvedValue("整理会议纪要");

    const result = await normalizeTelegramInput({
      baseDir: tempRoot,
      message: {
        attachments: [
          attachment({
            data: Buffer.from("voice"),
            mimeType: "audio/ogg",
            name: "voice.ogg",
            type: "audio",
          }),
        ],
        id: "m4",
        text: "",
      },
      sttConfig: { baseUrl: "https://stt.shellraining.xyz" },
      threadKey: "telegram__1",
      transcribeAudio: transcribe,
    });

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("[Telegram voice transcript]");
    expect(result.text).toContain("整理会议纪要");
    expect(result.text).toContain("[Telegram audio file]");
  });

  it("returns unprocessable input when no content was recognized", async () => {
    const { normalizeTelegramInput } =
      await import("../src/runtime/telegram-input.js");

    const result = await normalizeTelegramInput({
      baseDir: tempRoot,
      message: { id: "m5", text: "" },
      sttConfig: {},
      threadKey: "telegram__1",
    });

    expect(result.isProcessable).toBe(false);
    expect(result.text).toBe("");
  });
});
