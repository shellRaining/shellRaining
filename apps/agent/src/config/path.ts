import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const DEFAULT_BASE_DIR = "~/.shellRaining";
export const DEFAULT_WORKSPACE = "shellRaining-workspace";

export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end--;
  }
  return value.slice(0, end);
}

export function expandHome(path: string, home = homedir()): string {
  if (path === "~") {
    return home;
  }
  if (path.startsWith("~/")) {
    return join(home, path.slice(2));
  }
  return path;
}

export function resolveDefaultBaseDir(home = homedir()): string {
  return expandHome(DEFAULT_BASE_DIR, home);
}

export function resolveDefaultWorkspace(baseDir: string): string {
  return join(baseDir, DEFAULT_WORKSPACE);
}

export function resolveWorkspacePath(path: string, baseDir: string, home = homedir()): string {
  const expanded = expandHome(path, home);
  return isAbsolute(expanded) ? expanded : join(baseDir, expanded);
}

export function getConfigPath(home = homedir()): string {
  return join(resolveDefaultBaseDir(home), "config.json");
}

export function getWorkspaceStatePath(baseDir: string): string {
  return join(baseDir, "state", "workspaces.json");
}

export function getCronJobsPath(baseDir: string): string {
  return join(baseDir, "cron", "jobs.json");
}

export function getTelegramInboxPath(
  baseDir: string,
  threadKey: string,
  messageId: string,
): string {
  return join(baseDir, "inbox", threadKey, messageId);
}

export function getTelegramInboxDisplayPath(): string {
  return `${DEFAULT_BASE_DIR}/inbox/`;
}

export function getProfileRoot(baseDir: string, piProfile: string): string {
  return join(baseDir, "pi-profiles", piProfile);
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
