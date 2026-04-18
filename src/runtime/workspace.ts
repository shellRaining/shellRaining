import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

let stateFilePath = join(homedir(), ".shellRaining", "state", "workspaces.json");

interface WorkspaceState {
  [threadId: string]: string;
}

let state: WorkspaceState = {};
let loaded = false;

async function ensureStateDir(): Promise<void> {
  await mkdir(dirname(stateFilePath), { recursive: true });
}

async function loadState(): Promise<void> {
  if (loaded) {
    return;
  }

  try {
    const data = await readFile(stateFilePath, "utf-8");
    state = JSON.parse(data) as WorkspaceState;
  } catch {
    state = {};
  }

  loaded = true;
}

async function saveState(): Promise<void> {
  await ensureStateDir();
  await writeFile(stateFilePath, JSON.stringify(state, null, 2));
}

/**
 * Reconfigures the workspace state file path. Called once at startup so that
 * state is stored relative to the configured `baseDir` rather than the default
 * `~/.shellRaining/state/`. Also resets in-memory state, which is necessary
 * between test runs.
 */
export function configureWorkspaceState(baseDir: string): void {
  stateFilePath = join(baseDir, "state", "workspaces.json");
  resetWorkspaceStateForTesting();
}

export async function getWorkspace(
  threadId: string,
  fallbackWorkspace: string = homedir(),
): Promise<string> {
  await loadState();
  const cwd = state[threadId];

  if (cwd) {
    try {
      const stats = await stat(cwd);
      if (stats.isDirectory()) {
        return cwd;
      }
    } catch {}
  }

  return fallbackWorkspace;
}

/**
 * Changes the working directory for a thread. Supports `~` expansion and
 * relative paths (resolved against the thread's current directory).
 * Persists the result to disk so it survives restarts.
 *
 * @throws When the resolved path does not exist or is not a directory.
 */
export async function setWorkspace(
  threadId: string,
  path: string,
  fallbackWorkspace: string = homedir(),
): Promise<string> {
  await loadState();

  let resolved = path;
  if (path.startsWith("~")) {
    resolved = join(homedir(), path.slice(1));
  } else if (!path.startsWith("/")) {
    const current = await getWorkspace(threadId, fallbackWorkspace);
    resolved = resolve(current, path);
  }

  try {
    await access(resolved);
    const stats = await stat(resolved);
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Not a directory")) {
      throw error;
    }
    throw new Error(`Directory not found: ${resolved}`);
  }

  state[threadId] = resolved;
  await saveState();
  return resolved;
}

export function formatPath(path: string): string {
  const home = homedir();
  if (path === home) {
    return "~";
  }
  if (path.startsWith(`${home}/`)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

export function resetWorkspaceStateForTesting(): void {
  state = {};
  loaded = false;
}
