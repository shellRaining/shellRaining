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

export function safeTelegramFilename(filename: string | undefined, fallbackFilename: string): string {
  const trimmed = filename?.trim();
  if (!trimmed) {
    return fallbackFilename;
  }

  const base = basename(trimmed).trim();
  return base || fallbackFilename;
}

export async function saveTelegramAttachment(input: SaveTelegramAttachmentInput): Promise<SavedTelegramAttachment> {
  const filename = safeTelegramFilename(input.attachment.filename, input.attachment.fallbackFilename);
  const directory = join(input.baseDir, "inbox", safePathSegment(input.threadKey), safePathSegment(input.messageId));
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
