import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getTelegramInboxPath } from "../config/path.js";

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
  return value.replaceAll(/[^a-zA-Z0-9._-]+/g, "_").replaceAll(/^_+|_+$/g, "") || "message";
}

function safeTelegramFilenameCandidate(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") {
    return undefined;
  }

  const base = basename(trimmed).trim();
  if (!base || base === "." || base === ".." || base.includes("/") || base.includes("\\")) {
    return undefined;
  }

  return base;
}

/**
 * Produces a safe filename for saving a Telegram attachment.
 *
 * Resolution order: original `filename` → `fallbackFilename` → `"attachment.bin"`.
 * Rejects path-traversal names (e.g. `".."`, `"/etc/passwd"`) by extracting only the basename
 * and discarding entries that equal `.` or `..`.
 */
export function safeTelegramFilename(
  filename: string | undefined,
  fallbackFilename: string,
): string {
  return (
    safeTelegramFilenameCandidate(filename) ??
    safeTelegramFilenameCandidate(fallbackFilename) ??
    "attachment.bin"
  );
}

/** Saves attachment bytes to `inbox/{threadKey}/{messageId}/` under `baseDir`. */
export async function saveTelegramAttachment(
  input: SaveTelegramAttachmentInput,
): Promise<SavedTelegramAttachment> {
  const filename = safeTelegramFilename(
    input.attachment.filename,
    input.attachment.fallbackFilename,
  );
  const directory = getTelegramInboxPath(
    input.baseDir,
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
