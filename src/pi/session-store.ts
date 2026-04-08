import { join } from "node:path";

export function getThreadKeyFromId(threadId: string): string {
  return threadId.replaceAll(":", "__");
}

export function getSessionDirectoryForThread(baseDir: string, threadKey: string): string {
  return join(baseDir, "sessions", threadKey);
}
