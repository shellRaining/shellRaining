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
  transcribeAudio?: (
    input: TranscribeAudioInput,
  ) => Promise<string | undefined>;
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

  for (const [index, attachment] of (
    options.message.attachments ?? []
  ).entries()) {
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
        const mimeType = attachment.mimeType || "image/jpeg";
        if (mimeType.startsWith("image/")) {
          images.push({
            type: "image",
            data: data.toString("base64"),
            mimeType,
          });
          parts.push(`[Telegram image: ${saved.path}]`);
        } else {
          warnings.push(
            `Image attachment ${saved.filename} did not include an image MIME type.`,
          );
          documentLines.push(
            `- ${saved.filename}${saved.mimeType ? ` (${saved.mimeType})` : ""}: ${saved.path}`,
          );
        }
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
            const message =
              error instanceof Error ? error.message : String(error);
            warnings.push(`STT failed for ${saved.filename}: ${message}`);
          }
        }
        parts.push(`[Telegram audio file]\n${saved.path}`);
        continue;
      }

      documentLines.push(
        `- ${saved.filename}${saved.mimeType ? ` (${saved.mimeType})` : ""}: ${saved.path}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(
        `Failed to process attachment ${attachment.name || index + 1}: ${message}`,
      );
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
    isProcessable:
      normalizedText.length > 0 || images.length > 0 || savedFiles.length > 0,
    savedFiles,
    text: normalizedText,
    warnings,
  };
}
