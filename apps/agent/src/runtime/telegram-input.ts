import type { Attachment } from "chat";
import type { SttConfig, TranscribeAudioInput } from "./stt.js";
import { transcribeAudio as defaultTranscribeAudio } from "./stt.js";
import {
  saveTelegramAttachment,
  type SavedTelegramAttachment,
  type TelegramSavedAttachmentType,
} from "./telegram-attachments.js";

/** Base64-encoded image payload sent to the Pi agent. */
export interface PiImageInput {
  type: "image";
  /** Base64-encoded image data. */
  data: string;
  /** MIME type of the image (e.g. `"image/png"`). */
  mimeType: string;
}

/** Raw Telegram message with optional attachments and sticker metadata. */
export interface TelegramInputMessage {
  /** Media attachments (images, audio, documents, video). */
  attachments?: Attachment[];
  /** Telegram message ID, used for naming saved files. */
  id: string;
  /** Raw Telegram-specific metadata not covered by the standard `Attachment` type. */
  raw?: {
    sticker?: {
      /** Unicode emoji associated with the sticker (e.g. "😀"). */
      emoji?: string;
    };
  };
  text?: string | null;
}

export function isTelegramInputMessage(value: unknown): value is TelegramInputMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof (value as Record<string, unknown>).id === "string"
  );
}

/** Options for normalizing a Telegram message into a unified format for the Pi agent. */
export interface NormalizeTelegramInputOptions {
  /** Root directory for saving attachments. */
  baseDir: string;
  message: TelegramInputMessage;
  sttConfig: SttConfig;
  /** Thread key used to create per-thread attachment subdirectories. */
  threadKey: string;
  /** Override the STT function (useful for testing). */
  transcribeAudio?: (input: TranscribeAudioInput) => Promise<string | undefined>;
}

/** Telegram message normalized into text + images, ready for the Pi agent. */
export interface NormalizedTelegramInput {
  /** Extracted images encoded as base64 for inline Pi agent consumption. */
  images: PiImageInput[];
  /** Whether the input contains anything processable (text, images, or saved files). */
  isProcessable: boolean;
  /** All attachments successfully saved to disk during normalization. */
  savedFiles: SavedTelegramAttachment[];
  /** Combined text: original message + transcripts + file paths + warnings. */
  text: string;
  /** Non-fatal issues encountered during normalization (e.g. oversized attachments, STT failures). */
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

function formatAttachmentSize(size: number | undefined): string | undefined {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    return undefined;
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return unitIndex === 0
    ? `${value} ${units[unitIndex]}`
    : `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatAttachmentProcessingFailure(
  attachment: Attachment,
  index: number,
  message: string,
): string {
  const label = attachment.name ?? String(index + 1);
  if (/file is too big/i.test(message)) {
    const size = formatAttachmentSize(attachment.size);
    const sizeSuffix = size === undefined ? "" : ` (${size})`;
    return [
      `Telegram refused to download attachment ${label}${sizeSuffix}: ${message}.`,
      "This is a Telegram Bot API download limit, not a shellRaining internal file size limit.",
    ].join(" ");
  }

  return `Failed to process attachment ${label}: ${message}`;
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

interface AttachmentProcessingState {
  parts: string[];
  images: PiImageInput[];
  savedFiles: SavedTelegramAttachment[];
  documentLines: string[];
  warnings: string[];
}

async function tryTranscribeAudio(
  transcribe: (input: TranscribeAudioInput) => Promise<string | undefined>,
  sttConfig: SttConfig,
  data: Buffer,
  saved: SavedTelegramAttachment,
  state: AttachmentProcessingState,
): Promise<void> {
  if (sttConfig.baseUrl === undefined || sttConfig.baseUrl === "") {
    return;
  }
  try {
    const transcript = await transcribe({
      config: sttConfig,
      data,
      filename: saved.filename,
      mimeType: saved.mimeType,
    });
    if (transcript !== undefined && transcript.trim() !== "") {
      state.parts.push(`[Telegram voice transcript]\n${transcript.trim()}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.warnings.push(`STT failed for ${saved.filename}: ${message}`);
  }
}

async function processAttachment(
  attachment: Attachment,
  index: number,
  options: NormalizeTelegramInputOptions,
  transcribe: (input: TranscribeAudioInput) => Promise<string | undefined>,
  state: AttachmentProcessingState,
): Promise<void> {
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
    state.savedFiles.push(saved);
    if (attachment.type === "image") {
      const mimeType = attachment.mimeType ?? "image/jpeg";
      if (mimeType.startsWith("image/")) {
        state.images.push({
          type: "image",
          data: data.toString("base64"),
          mimeType,
        });
        state.parts.push(`[Telegram image: ${saved.path}]`);
      } else {
        state.warnings.push(
          `Image attachment ${saved.filename} did not include an image MIME type.`,
        );
        state.documentLines.push(
          `- ${saved.filename}${saved.mimeType === undefined ? "" : ` (${saved.mimeType})`}: ${saved.path}`,
        );
      }
      return;
    }
    if (attachment.type === "audio") {
      await tryTranscribeAudio(transcribe, options.sttConfig, data, saved, state);
      state.parts.push(`[Telegram audio file]\n${saved.path}`);
      return;
    }
    state.documentLines.push(
      `- ${saved.filename}${saved.mimeType === undefined ? "" : ` (${saved.mimeType})`}: ${saved.path}`,
    );
  } catch (error) {
    state.warnings.push(
      formatAttachmentProcessingFailure(
        attachment,
        index,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

/**
 * Convert a raw Telegram message (text + attachments) into a unified format
 * consumable by the Pi agent.
 *
 * Handles images (base64 for inline agent input), audio (optional STT
 * transcription), documents (file path references), and stickers (emoji text).
 * All downloadable attachments are saved to disk; warnings are collected for
 * non-fatal failures.
 */
export async function normalizeTelegramInput(
  options: NormalizeTelegramInputOptions,
): Promise<NormalizedTelegramInput> {
  const state: AttachmentProcessingState = {
    parts: [],
    images: [],
    savedFiles: [],
    documentLines: [],
    warnings: [],
  };
  const text = options.message.text?.trim();
  const transcribe = options.transcribeAudio ?? defaultTranscribeAudio;

  if (text !== undefined && text !== "") {
    state.parts.push(text);
  }

  const rawSticker = options.message.raw?.sticker;
  if (rawSticker) {
    state.parts.push(`[Telegram sticker: emoji=${rawSticker.emoji ?? "unknown"}]`);
  }

  for (const [index, attachment] of (options.message.attachments ?? []).entries()) {
    await processAttachment(attachment, index, options, transcribe, state);
  }

  if (state.documentLines.length > 0) {
    state.parts.push(`[Telegram attachments]\n${state.documentLines.join("\n")}`);
  }

  if (state.warnings.length > 0) {
    state.parts.push(
      `[Telegram input warnings]\n${state.warnings.map((warning) => `- ${warning}`).join("\n")}`,
    );
  }

  const normalizedText = state.parts.join("\n\n").trim();
  return {
    images: state.images,
    isProcessable:
      normalizedText.length > 0 || state.images.length > 0 || state.savedFiles.length > 0,
    savedFiles: state.savedFiles,
    text: normalizedText,
    warnings: state.warnings,
  };
}
