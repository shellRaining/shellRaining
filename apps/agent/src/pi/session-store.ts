import { join } from "node:path";

/**
 * Replaces `:` with `__` because `:` is not safe for filesystem paths
 * (e.g. forbidden in Windows filenames, used as path separator in some contexts).
 */
export function getThreadKeyFromId(threadId: string): string {
  return threadId.replaceAll(":", "__");
}

export function getThreadIdFromKey(threadKey: string): string {
  return threadKey.replaceAll("__", ":");
}

export function getChatIdFromThreadKey(threadKey: string): number {
  const threadId = getThreadIdFromKey(threadKey);
  const numeric = threadId.replace(/\D/g, "");
  return Number.parseInt(numeric, 10) || 0;
}

export function getSessionDirectoryForThread(baseDir: string, threadKey: string): string {
  return join(baseDir, "sessions", threadKey);
}

export function getSessionDirectoryForScope(
  baseDir: string,
  scope: { agentId: string; threadKey: string },
): string {
  return join(baseDir, "sessions", scope.agentId, scope.threadKey);
}
