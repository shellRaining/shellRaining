import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Attachment } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempRoot: string;

function attachment(input: Partial<Attachment> & { type: Attachment["type"] }): Attachment {
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
    const { normalizeTelegramInput } = await import("../src/runtime/telegram-input.js");

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
    const { normalizeTelegramInput } = await import("../src/runtime/telegram-input.js");

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

  it("treats Telegram photos without MIME as JPEG image input", async () => {
    const { normalizeTelegramInput } = await import("../src/runtime/telegram-input.js");

    const result = await normalizeTelegramInput({
      baseDir: tempRoot,
      message: {
        attachments: [
          attachment({
            data: Buffer.from("telegram-photo"),
            name: "telegram-photo",
            type: "image",
          }),
        ],
        id: "m2a",
        text: "",
      },
      sttConfig: {},
      threadKey: "telegram__1",
    });

    expect(result.images).toEqual([
      {
        type: "image",
        data: Buffer.from("telegram-photo").toString("base64"),
        mimeType: "image/jpeg",
      },
    ]);
    expect(result.text).toContain("[Telegram image:");
    expect(result.warnings).toEqual([]);
    expect(result.savedFiles[0]?.filename).toBe("telegram-photo");
  });

  it("keeps image-typed attachments with non-image MIME as generic attachments", async () => {
    const { normalizeTelegramInput } = await import("../src/runtime/telegram-input.js");

    const result = await normalizeTelegramInput({
      baseDir: tempRoot,
      message: {
        attachments: [
          attachment({
            data: Buffer.from("pdf-data"),
            mimeType: "application/pdf",
            name: "mislabelled.pdf",
            type: "image",
          }),
        ],
        id: "m2b",
        text: "",
      },
      sttConfig: {},
      threadKey: "telegram__1",
    });

    expect(result.images).toEqual([]);
    expect(result.text).not.toContain("[Telegram image:");
    expect(result.text).toContain("[Telegram attachments]");
    expect(result.text).toContain("mislabelled.pdf (application/pdf):");
    expect(result.warnings).toEqual([
      "Image attachment mislabelled.pdf did not include an image MIME type.",
    ]);
  });

  it("keeps document attachments as file paths without parsing contents", async () => {
    const { normalizeTelegramInput } = await import("../src/runtime/telegram-input.js");

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

  it("explains Telegram oversized download failures without implying an internal limit", async () => {
    const { normalizeTelegramInput } = await import("../src/runtime/telegram-input.js");

    const result = await normalizeTelegramInput({
      baseDir: tempRoot,
      message: {
        attachments: [
          attachment({
            fetchData: async () => {
              throw new Error("Bad Request: file is too big");
            },
            mimeType: "application/pdf",
            name: "large.pdf",
            size: 25 * 1024 * 1024,
            type: "file",
          }),
        ],
        id: "m3a",
        text: "how many pages?",
      },
      sttConfig: {},
      threadKey: "telegram__1",
    });

    expect(result.savedFiles).toEqual([]);
    expect(result.text).toContain("[Telegram input warnings]");
    expect(result.warnings).toEqual([
      "Telegram refused to download attachment large.pdf (25.0 MB): Bad Request: file is too big. This is a Telegram Bot API download limit, not a shellRaining internal file size limit.",
    ]);
  });

  it("adds STT transcript for audio when the transcriber succeeds", async () => {
    const { normalizeTelegramInput } = await import("../src/runtime/telegram-input.js");
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

  it("keeps audio file path without warning when STT is not configured", async () => {
    const { normalizeTelegramInput } = await import("../src/runtime/telegram-input.js");
    const transcribe = vi.fn().mockResolvedValue("unused transcript");

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
        id: "m4b",
        text: "",
      },
      sttConfig: {},
      threadKey: "telegram__1",
      transcribeAudio: transcribe,
    });

    expect(transcribe).not.toHaveBeenCalled();
    expect(result.text).toContain("[Telegram audio file]");
    expect(result.text).not.toContain("[Telegram input warnings]");
    expect(result.warnings).toEqual([]);
  });

  it("returns unprocessable input when no content was recognized", async () => {
    const { normalizeTelegramInput } = await import("../src/runtime/telegram-input.js");

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
