import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

/** File extensions recognized as image attachments (sent as Telegram photos). */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
/** File extensions recognized as document attachments (sent as Telegram documents). */
const DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".html",
  ".xml",
  ".yaml",
  ".yml",
]);

/** A file created by the Pi agent, categorized for Telegram upload. */
export interface DetectedArtifact {
  /** Absolute path on disk. */
  path: string;
  /** Filename portion only (displayed in Telegram). */
  filename: string;
  /** Telegram upload method: `"photo"` for images, `"document"` for everything else. */
  type: "photo" | "document";
}

/**
 * Scan Pi agent output for file paths mentioned in common LLM phrasing patterns.
 * Only absolute paths (starting with `/`) are collected.
 */
export function parseOutputForFiles(output: string): string[] {
  const patterns = [
    /(?:Created|Saved to|Wrote|Output|File saved|Generated|Exported):\s*([^\s]+\.\w+)/gi,
    /(?:saved|wrote|created|generated|exported)\s+(?:to\s+)?["']?([^\s"']+\.\w+)["']?/gi,
    /(?:file|output):\s*["']?([^\s"']+\.\w+)["']?/gi,
  ];

  const files = new Set<string>();

  for (const pattern of patterns) {
    const matches = output.matchAll(pattern);
    for (const match of matches) {
      const filePath = match[1];
      if (filePath?.startsWith("/")) {
        files.add(filePath);
      }
    }
  }

  return Array.from(files);
}

/** Returns a map of file path → last-modified timestamp for every file in `dir`. */
async function getFileList(dir: string): Promise<Map<string, number>> {
  const files = new Map<string, number>();

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = join(dir, entry.name);
        try {
          const stats = await stat(filePath);
          files.set(filePath, stats.mtimeMs);
        } catch {
          // Ignore unreadable entries.
        }
      }
    }
  } catch {
    // Ignore missing or unreadable directories.
  }

  return files;
}

/**
 * Diff the workspace file list against a prior snapshot.
 * Returns paths that are new or whose mtime increased since `beforeFiles`.
 */
export async function detectNewFiles(
  workspace: string,
  beforeFiles: Map<string, number>,
): Promise<string[]> {
  const afterFiles = await getFileList(workspace);
  const newFiles: string[] = [];

  for (const [path, mtime] of afterFiles) {
    const beforeMtime = beforeFiles.get(path);
    if (beforeMtime === undefined || mtime > beforeMtime) {
      newFiles.push(path);
    }
  }

  return newFiles;
}

/** Capture the current file list and mtimes for later diffing via `detectNewFiles`. */
export async function snapshotWorkspace(workspace: string): Promise<Map<string, number>> {
  return getFileList(workspace);
}

/** Classify file paths as photo or document based on their extension. */
export function categorizeFiles(filePaths: string[]): DetectedArtifact[] {
  const result: DetectedArtifact[] = [];

  for (const filePath of filePaths) {
    const ext = extname(filePath).toLowerCase();
    const filename = filePath.split("/").pop() ?? filePath;

    if (IMAGE_EXTENSIONS.has(ext)) {
      result.push({ path: filePath, filename, type: "photo" });
    } else if (DOCUMENT_EXTENSIONS.has(ext)) {
      result.push({ path: filePath, filename, type: "document" });
    }
  }

  return result;
}

/**
 * Detect artifacts created by the Pi agent using two strategies:
 * 1. Parse the agent output text for file path mentions.
 * 2. Diff the workspace filesystem against a pre-run snapshot.
 * Merges both sources, deduplicates, and categorizes for Telegram upload.
 */
export async function detectFiles(
  output: string,
  workspace: string,
  beforeSnapshot: Map<string, number>,
): Promise<DetectedArtifact[]> {
  const parsedFiles = parseOutputForFiles(output);
  const newFiles = await detectNewFiles(workspace, beforeSnapshot);
  const allFiles = new Set([...parsedFiles, ...newFiles]);
  return categorizeFiles(Array.from(allFiles));
}
