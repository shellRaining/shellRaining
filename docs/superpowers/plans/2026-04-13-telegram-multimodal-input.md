# Telegram Multimodal Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Telegram multimodal input happy path for images, files, stickers, and voice/audio while keeping Pi CodingAgent as the only execution core.

**Architecture:** Add a Telegram input normalization layer between Chat SDK messages and `PiRuntime.prompt()`. The normalizer downloads Telegram attachments into `~/.shellRaining/inbox/`, passes image bytes to Pi as `images`, passes non-image files as absolute paths in prompt text, and optionally calls an OpenAI-compatible STT endpoint for voice/audio transcripts. Bot routing stays thin: auth, command handling, normalization, rate limit, Pi prompt, reply.

**Tech Stack:** Node.js 22, TypeScript, Hono, chat, @chat-adapter/telegram, @mariozechner/pi-coding-agent, Vitest, global fetch/FormData/Blob

---

## File Structure

- Modify `src/config.ts`: add optional STT config to `Config`.
- Modify `tests/config.test.ts`: verify STT env parsing.
- Modify `src/runtime/service-profile.ts`: add Telegram attachment guidance to the appended Pi system prompt.
- Modify `tests/service-profile.test.ts`: verify attachment guidance appears.
- Create `src/runtime/stt.ts`: OpenAI-compatible audio transcription client.
- Create `tests/stt.test.ts`: verify disabled STT, request construction, and response parsing.
- Create `src/runtime/telegram-attachments.ts`: safe attachment filename and filesystem storage helper.
- Create `tests/telegram-attachments.test.ts`: verify safe filenames and saved path layout.
- Create `src/runtime/telegram-input.ts`: normalize Chat SDK Telegram messages into prompt text, image blocks, saved files, and warnings.
- Create `tests/telegram-input.test.ts`: verify text/caption, image, file, audio/STT, sticker, and empty-input behavior.
- Modify `src/pi/runtime.ts`: accept optional image inputs and pass them to Pi SDK.
- Create `tests/pi-runtime.test.ts`: mock Pi SDK and verify images are forwarded.
- Modify `src/bot.ts`: route actual `message` objects into the normalizer instead of passing only `message.text`.
- Create `tests/bot-input.test.ts`: verify pure attachment messages call Pi and empty unrecognized messages do not.
- Modify `README.md`: document supported Telegram inputs and optional STT env vars.

Each implementation task ends with its own commit. Do not batch all feature work into one final commit.

---

### Task 1: Add STT Config And Telegram Attachment Prompt Guidance

**Files:**

- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`
- Modify: `src/runtime/service-profile.ts`
- Modify: `tests/service-profile.test.ts`

- [ ] **Step 1: Write failing config and service-profile tests**

Add this test to `tests/config.test.ts`:

```ts
it("parses optional STT config", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.SHELL_RAINING_STT_BASE_URL = " https://stt.shellraining.xyz/ ";
  process.env.SHELL_RAINING_STT_API_KEY = " stt-secret ";
  process.env.SHELL_RAINING_STT_MODEL = " faster-whisper-large-v3 ";

  const { loadConfig } = await import("../src/config.js");
  const config = loadConfig();

  expect(config.stt).toEqual({
    apiKey: "stt-secret",
    baseUrl: "https://stt.shellraining.xyz",
    model: "faster-whisper-large-v3",
  });
});
```

Add this test to `tests/service-profile.test.ts`:

```ts
it("renders Telegram attachment handling guidance", () => {
  const result = buildServiceProfileContext({
    apiBaseUrl: "https://api.shellraining.xyz",
    crawlUrl: "https://crawl.shellraining.xyz",
    vikunjaUrl: "https://todo.shellraining.xyz",
  });

  expect(result).toContain("[Telegram attachments]");
  expect(result).toContain("Do not claim you read an attachment before reading it");
  expect(result).toContain("~/.shellRaining/inbox/");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test tests/config.test.ts tests/service-profile.test.ts
```

Expected: FAIL because `config.stt` is missing and the service profile does not yet contain Telegram attachment guidance.

- [ ] **Step 3: Implement STT config and prompt guidance**

In `src/config.ts`, add this property to `Config`:

```ts
  stt: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
```

Add this helper near `parseBoolean()`:

```ts
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end--;
  }
  return value.slice(0, end);
}
```

Add this object to the returned config in `loadConfig()`:

```ts
    stt: {
      apiKey: process.env.SHELL_RAINING_STT_API_KEY?.trim() || undefined,
      baseUrl: process.env.SHELL_RAINING_STT_BASE_URL?.trim()
        ? trimTrailingSlashes(process.env.SHELL_RAINING_STT_BASE_URL.trim())
        : undefined,
      model: process.env.SHELL_RAINING_STT_MODEL?.trim() || undefined,
    },
```

In `src/runtime/service-profile.ts`, append these lines in `buildServiceProfileContext()` before the existing final line `"Prefer these service endpoints when a skill needs the user's self-hosted infrastructure."`:

```ts
    "Telegram input attachments are saved locally under ~/.shellRaining/inbox/ and are referenced with absolute paths.",
    "When the user sends [Telegram attachments], inspect the listed files only when needed for the request.",
    "Do not claim you read an attachment before reading it.",
    "For PDFs, spreadsheets, office documents, archives, and other non-text files, use bash or existing tools to inspect or convert them as needed.",
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test tests/config.test.ts tests/service-profile.test.ts
```

Expected: PASS for both test files.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/config.ts tests/config.test.ts src/runtime/service-profile.ts tests/service-profile.test.ts
git commit -m "feat: add stt config and attachment guidance"
```

---

### Task 2: Add OpenAI-Compatible STT Client

**Files:**

- Create: `src/runtime/stt.ts`
- Create: `tests/stt.test.ts`

- [ ] **Step 1: Write failing STT client tests**

Create `tests/stt.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("stt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns undefined when STT base URL is not configured", async () => {
    const { transcribeAudio } = await import("../src/runtime/stt.js");

    const result = await transcribeAudio({
      config: {},
      data: Buffer.from("voice"),
      filename: "voice.ogg",
      mimeType: "audio/ogg",
    });

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts audio to the OpenAI-compatible transcriptions endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: "整理会议纪要" }),
    });

    const { transcribeAudio } = await import("../src/runtime/stt.js");
    const result = await transcribeAudio({
      config: {
        apiKey: "secret",
        baseUrl: "https://stt.shellraining.xyz/",
        model: "faster-whisper-large-v3",
      },
      data: Buffer.from("voice"),
      filename: "voice.ogg",
      mimeType: "audio/ogg",
    });

    expect(result).toBe("整理会议纪要");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://stt.shellraining.xyz/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer secret" });
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("model")).toBe("faster-whisper-large-v3");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("throws a clear error when STT returns a non-OK response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
    });

    const { transcribeAudio } = await import("../src/runtime/stt.js");

    await expect(
      transcribeAudio({
        config: { baseUrl: "https://stt.shellraining.xyz" },
        data: Buffer.from("voice"),
        filename: "voice.ogg",
        mimeType: "audio/ogg",
      }),
    ).rejects.toThrow("STT transcription failed: 503 service unavailable");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test tests/stt.test.ts
```

Expected: FAIL because `src/runtime/stt.ts` does not exist.

- [ ] **Step 3: Implement the STT client**

Create `src/runtime/stt.ts` with:

```ts
export interface SttConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface TranscribeAudioInput {
  config: SttConfig;
  data: Buffer;
  filename: string;
  mimeType?: string;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end--;
  }
  return value.slice(0, end);
}

export async function transcribeAudio(input: TranscribeAudioInput): Promise<string | undefined> {
  const baseUrl = input.config.baseUrl?.trim();
  if (!baseUrl) {
    return undefined;
  }

  const form = new FormData();
  form.append("model", input.config.model?.trim() || "whisper-1");
  form.append(
    "file",
    new Blob([new Uint8Array(input.data)], {
      type: input.mimeType || "application/octet-stream",
    }),
    input.filename,
  );

  const headers = input.config.apiKey?.trim()
    ? { Authorization: `Bearer ${input.config.apiKey.trim()}` }
    : undefined;

  const response = await fetch(`${trimTrailingSlashes(baseUrl)}/v1/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`STT transcription failed: ${response.status}${body ? ` ${body}` : ""}`);
  }

  const payload = (await response.json()) as { text?: unknown };
  return typeof payload.text === "string" ? payload.text : undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test tests/stt.test.ts
```

Expected: PASS for all STT tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/runtime/stt.ts tests/stt.test.ts
git commit -m "feat: add pluggable stt client"
```

---

### Task 3: Add Telegram Attachment Storage

**Files:**

- Create: `src/runtime/telegram-attachments.ts`
- Create: `tests/telegram-attachments.test.ts`

- [ ] **Step 1: Write failing attachment storage tests**

Create `tests/telegram-attachments.test.ts` with:

```ts
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
    expect(result.path).toBe(
      join(tempRoot, "inbox", "telegram__123__456", "telegram_123_456", "report.pdf"),
    );
    await expect(readFile(result.path, "utf-8")).resolves.toBe("hello");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test tests/telegram-attachments.test.ts
```

Expected: FAIL because `src/runtime/telegram-attachments.ts` does not exist.

- [ ] **Step 3: Implement attachment storage**

Create `src/runtime/telegram-attachments.ts` with:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type TelegramSavedAttachmentType = "image" | "file" | "audio" | "video";

export interface SaveTelegramAttachmentInput {
  attachment: {
    data: Buffer;
    fallbackFilename: string;
    filename?: string;
    mimeType?: string;
    type: TelegramSavedAttachmentType;
  };
  baseDir: string;
  messageId: string;
  threadKey: string;
}

export interface SavedTelegramAttachment {
  filename: string;
  mimeType?: string;
  path: string;
  size: number;
  type: TelegramSavedAttachmentType;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "message";
}

export function safeTelegramFilename(
  filename: string | undefined,
  fallbackFilename: string,
): string {
  const trimmed = filename?.trim();
  if (!trimmed) {
    return fallbackFilename;
  }

  const base = basename(trimmed).trim();
  return base || fallbackFilename;
}

export async function saveTelegramAttachment(
  input: SaveTelegramAttachmentInput,
): Promise<SavedTelegramAttachment> {
  const filename = safeTelegramFilename(
    input.attachment.filename,
    input.attachment.fallbackFilename,
  );
  const directory = join(
    input.baseDir,
    "inbox",
    safePathSegment(input.threadKey),
    safePathSegment(input.messageId),
  );
  await mkdir(directory, { recursive: true });

  const path = join(directory, filename);
  await writeFile(path, input.attachment.data);

  return {
    filename,
    mimeType: input.attachment.mimeType,
    path,
    size: input.attachment.data.byteLength,
    type: input.attachment.type,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test tests/telegram-attachments.test.ts
```

Expected: PASS for all attachment storage tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/runtime/telegram-attachments.ts tests/telegram-attachments.test.ts
git commit -m "feat: store telegram input attachments"
```

---

### Task 4: Add Telegram Input Normalizer

**Files:**

- Create: `src/runtime/telegram-input.ts`
- Create: `tests/telegram-input.test.ts`

- [ ] **Step 1: Write failing normalizer tests**

Create `tests/telegram-input.test.ts` with:

```ts
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
      { type: "image", data: Buffer.from("image-data").toString("base64"), mimeType: "image/png" },
    ]);
    expect(result.savedFiles[0]?.filename).toBe("photo.png");
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test tests/telegram-input.test.ts
```

Expected: FAIL because `src/runtime/telegram-input.ts` does not exist.

- [ ] **Step 3: Implement the normalizer**

Create `src/runtime/telegram-input.ts` with:

```ts
import type { Attachment } from "chat";
import type { SttConfig, TranscribeAudioInput } from "./stt.js";
import { transcribeAudio as defaultTranscribeAudio } from "./stt.js";
import {
  saveTelegramAttachment,
  type SavedTelegramAttachment,
  type TelegramSavedAttachmentType,
} from "./telegram-attachments.js";

export interface PiImageInput {
  type: "image";
  data: string;
  mimeType: string;
}

export interface TelegramInputMessage {
  attachments?: Attachment[];
  id: string;
  raw?: {
    sticker?: {
      emoji?: string;
    };
  };
  text?: string | null;
}

export interface NormalizeTelegramInputOptions {
  baseDir: string;
  message: TelegramInputMessage;
  sttConfig: SttConfig;
  threadKey: string;
  transcribeAudio?: (input: TranscribeAudioInput) => Promise<string | undefined>;
}

export interface NormalizedTelegramInput {
  images: PiImageInput[];
  isProcessable: boolean;
  savedFiles: SavedTelegramAttachment[];
  text: string;
  warnings: string[];
}

function attachmentType(type: Attachment["type"]): TelegramSavedAttachmentType {
  if (type === "image" || type === "audio" || type === "video") {
    return type;
  }
  return "file";
}

function fallbackFilename(type: Attachment["type"], index: number): string {
  return `telegram-${type}-${index + 1}.bin`;
}

async function loadAttachmentData(attachment: Attachment): Promise<Buffer> {
  if (Buffer.isBuffer(attachment.data)) {
    return attachment.data;
  }
  if (attachment.data instanceof Blob) {
    return Buffer.from(await attachment.data.arrayBuffer());
  }
  if (attachment.fetchData) {
    return attachment.fetchData();
  }
  throw new Error("Attachment has no data or fetchData()");
}

export async function normalizeTelegramInput(
  options: NormalizeTelegramInputOptions,
): Promise<NormalizedTelegramInput> {
  const parts: string[] = [];
  const images: PiImageInput[] = [];
  const savedFiles: SavedTelegramAttachment[] = [];
  const warnings: string[] = [];
  const text = options.message.text?.trim();
  const transcribe = options.transcribeAudio ?? defaultTranscribeAudio;

  if (text) {
    parts.push(text);
  }

  const rawSticker = options.message.raw?.sticker;
  if (rawSticker) {
    parts.push(`[Telegram sticker: emoji=${rawSticker.emoji || "unknown"}]`);
  }

  const documentLines: string[] = [];

  for (const [index, attachment] of (options.message.attachments ?? []).entries()) {
    try {
      const data = await loadAttachmentData(attachment);
      const saved = await saveTelegramAttachment({
        attachment: {
          data,
          fallbackFilename: fallbackFilename(attachment.type, index),
          filename: attachment.name,
          mimeType: attachment.mimeType,
          type: attachmentType(attachment.type),
        },
        baseDir: options.baseDir,
        messageId: options.message.id,
        threadKey: options.threadKey,
      });
      savedFiles.push(saved);

      if (attachment.type === "image") {
        const mimeType = attachment.mimeType || "application/octet-stream";
        if (mimeType.startsWith("image/")) {
          images.push({ type: "image", data: data.toString("base64"), mimeType });
        } else {
          warnings.push(`Image attachment ${saved.filename} did not include an image MIME type.`);
        }
        parts.push(`[Telegram image: ${saved.path}]`);
        continue;
      }

      if (attachment.type === "audio") {
        if (options.sttConfig.baseUrl) {
          try {
            const transcript = await transcribe({
              config: options.sttConfig,
              data,
              filename: saved.filename,
              mimeType: saved.mimeType,
            });
            if (transcript?.trim()) {
              parts.push(`[Telegram voice transcript]\n${transcript.trim()}`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`STT failed for ${saved.filename}: ${message}`);
          }
        } else {
          warnings.push(`STT is not configured for ${saved.filename}.`);
        }
        parts.push(`[Telegram audio file]\n${saved.path}`);
        continue;
      }

      documentLines.push(
        `- ${saved.filename}${saved.mimeType ? ` (${saved.mimeType})` : ""}: ${saved.path}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to process attachment ${attachment.name || index + 1}: ${message}`);
    }
  }

  if (documentLines.length > 0) {
    parts.push(`[Telegram attachments]\n${documentLines.join("\n")}`);
  }

  if (warnings.length > 0) {
    parts.push(
      `[Telegram input warnings]\n${warnings.map((warning) => `- ${warning}`).join("\n")}`,
    );
  }

  const normalizedText = parts.join("\n\n").trim();
  return {
    images,
    isProcessable: normalizedText.length > 0 || images.length > 0 || savedFiles.length > 0,
    savedFiles,
    text: normalizedText,
    warnings,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test tests/telegram-input.test.ts
```

Expected: PASS for all normalizer tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/runtime/telegram-input.ts tests/telegram-input.test.ts
git commit -m "feat: normalize telegram multimodal input"
```

---

### Task 5: Pass Image Inputs Through Pi Runtime

**Files:**

- Modify: `src/pi/runtime.ts`
- Create: `tests/pi-runtime.test.ts`

- [ ] **Step 1: Write failing Pi runtime image forwarding test**

Create `tests/pi-runtime.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

const sessionPrompt = vi.fn();
const sessionSubscribe = vi.fn(() => () => undefined);
const sessionDispose = vi.fn();

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn(async () => ({
    session: {
      dispose: sessionDispose,
      listSessions: vi.fn(),
      newSession: vi.fn(),
      prompt: sessionPrompt,
      subscribe: sessionSubscribe,
      switchSession: vi.fn(),
    },
  })),
  DefaultResourceLoader: vi.fn().mockImplementation(() => ({
    reload: vi.fn(),
  })),
  SessionManager: {
    continueRecent: vi.fn(() => ({})),
    list: vi.fn(() => []),
  },
}));

describe("PiRuntime", () => {
  it("passes image inputs to the Pi session prompt", async () => {
    sessionPrompt.mockResolvedValue(undefined);
    const { PiRuntime } = await import("../src/pi/runtime.js");

    const runtime = new PiRuntime({
      agentDir: "/mock/agent",
      allowedUsers: [],
      baseDir: "/mock/base",
      port: 1234,
      rateLimitCooldownMs: 0,
      serviceProfile: {
        apiBaseUrl: "https://api.shellraining.xyz",
        crawlUrl: "https://crawl.shellraining.xyz",
        vikunjaUrl: "https://todo.shellraining.xyz",
      },
      showThinking: false,
      skillsDir: "/mock/skills",
      stt: {},
      telegramToken: "token",
      workspace: "/mock/workspace",
    });

    await runtime.prompt("telegram__1", "describe this", "/mock/workspace", {
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });

    expect(sessionPrompt).toHaveBeenCalledWith("describe this", {
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test tests/pi-runtime.test.ts
```

Expected: FAIL because `PiRuntime.prompt()` does not accept or forward `images`.

- [ ] **Step 3: Implement Pi runtime image forwarding**

In `src/pi/runtime.ts`, add this interface near `PiPromptCallbacks`:

```ts
export interface PiImageInput {
  type: "image";
  data: string;
  mimeType: string;
}
```

Update `PiPromptCallbacks`:

```ts
export interface PiPromptCallbacks {
  images?: PiImageInput[];
  onStatus?: (status: string) => Promise<void> | void;
}
```

In `runPrompt()`, replace:

```ts
await session.prompt(text);
```

with:

```ts
await session.prompt(text, callbacks.images?.length ? { images: callbacks.images } : undefined);
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test tests/pi-runtime.test.ts
```

Expected: PASS for the image forwarding test.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/pi/runtime.ts tests/pi-runtime.test.ts
git commit -m "feat: pass telegram images to pi"
```

---

### Task 6: Integrate Normalized Input Into Bot Routing

**Files:**

- Modify: `src/bot.ts`
- Create: `tests/bot-input.test.ts`

- [ ] **Step 1: Write failing bot routing tests**

Create `tests/bot-input.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { isTelegramInputProcessable } from "../src/bot.js";

describe("bot telegram input routing", () => {
  it("treats pure attachment input as processable", () => {
    expect(
      isTelegramInputProcessable({
        images: [],
        isProcessable: true,
        savedFiles: [
          {
            filename: "report.pdf",
            mimeType: "application/pdf",
            path: "/tmp/report.pdf",
            size: 10,
            type: "file",
          },
        ],
        text: "[Telegram attachments]\n- report.pdf: /tmp/report.pdf",
        warnings: [],
      }),
    ).toBe(true);
  });

  it("treats empty normalized input as not processable", () => {
    expect(
      isTelegramInputProcessable({
        images: [],
        isProcessable: false,
        savedFiles: [],
        text: "",
        warnings: [],
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test tests/bot-input.test.ts
```

Expected: FAIL because `isTelegramInputProcessable` is not exported and bot routing still only accepts text.

- [ ] **Step 3: Implement bot routing integration**

In `src/bot.ts`, update imports:

```ts
import {
  normalizeTelegramInput,
  type NormalizedTelegramInput,
  type TelegramInputMessage,
} from "./runtime/telegram-input.js";
```

Add this helper near `shouldFallbackToRawTelegramReply()`:

```ts
export function isTelegramInputProcessable(input: NormalizedTelegramInput): boolean {
  return input.isProcessable;
}
```

Change the `handlePrompt()` signature:

```ts
async function handlePrompt(thread: Thread, message: TelegramInputMessage, config: Config, runtime: PiRuntime): Promise<void> {
```

Inside `handlePrompt()`, before rate limiting, add normalization:

```ts
const normalized = await normalizeTelegramInput({
  baseDir: config.baseDir,
  message,
  sttConfig: config.stt,
  threadKey,
});
if (!isTelegramInputProcessable(normalized)) {
  await thread.post("没有识别到可处理的 Telegram 输入。请发送文本、图片、文件、语音或贴纸。");
  return;
}
```

Change the Pi call in `handlePrompt()` to:

```ts
const result = await runtime.prompt(threadKey, normalized.text, workspace, {
  images: normalized.images,
  onStatus: async (status) => {
    await thread.startTyping(status);
  },
});
```

In all three message handlers, replace:

```ts
await handlePrompt(thread, message.text || "", config, runtime);
```

with:

```ts
await handlePrompt(thread, message as TelegramInputMessage, config, runtime);
```

Keep command handling based on `message.text || ""` so existing slash commands behave as before.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm test tests/bot-input.test.ts tests/telegram-input.test.ts tests/bot-format.test.ts
```

Expected: PASS for bot routing, input normalization, and existing bot formatting tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/bot.ts tests/bot-input.test.ts
git commit -m "feat: route telegram multimodal input"
```

---

### Task 7: Document Usage And Run Full Verification

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update README with supported input and STT env vars**

Add this section after the feature list in `README.md`:

````md
Telegram input support:

- Text and emoji are sent to Pi as prompt text.
- Telegram photo/image attachments are downloaded, saved under `~/.shellRaining/inbox/`, and passed to Pi as image inputs.
- Telegram document attachments such as TXT, PDF, and XLSX are downloaded and sent to Pi as local absolute file paths. shellRaining does not parse document contents itself.
- Telegram voice/audio attachments are downloaded and sent as local absolute file paths. When STT is configured, the transcript is included in the prompt.
- Telegram stickers are represented as lightweight text using their sticker emoji when Telegram provides one.

Optional STT configuration:

```bash
SHELL_RAINING_STT_BASE_URL=https://stt.example.com
SHELL_RAINING_STT_API_KEY=optional-token
SHELL_RAINING_STT_MODEL=whisper-1
```
````

- [ ] **Step 2: Run all tests**

Run:

```bash
pnpm test
```

Expected: PASS for the full Vitest suite.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS with TypeScript exit code 0.

- [ ] **Step 4: Commit docs and verification-only fixes**

Include the README update in this commit. If the verification commands exposed a small test or typecheck issue, include only that fix with the README update; leave unrelated feature work for the task that owns it.

Run:

```bash
git add README.md
git commit -m "docs: document telegram multimodal input"
```

Expected: Commit succeeds.

---

## Self-Review Checklist

- Spec coverage:
  - Telegram input normalizer: Task 4.
  - Attachment storage under `~/.shellRaining/inbox/`: Task 3 and Task 4.
  - Images passed to Pi without model capability probing: Task 4 and Task 5.
  - Non-image files passed as paths without parsing: Task 4.
  - OpenAI-compatible STT config and client: Task 1 and Task 2.
  - Sticker emoji text representation: Task 4.
  - Bot routing no longer sends empty prompt for unrecognized input: Task 6.
  - System prompt guidance: Task 1.
  - Full tests and typecheck: Task 7.
- No file parsing for TXT/PDF/XLSX is planned.
- No concrete STT model or service is selected.
- Every implementation task has a dedicated commit step.
