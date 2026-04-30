import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";

interface ProfileWatcherOptions {
  debounceMs: number;
  onAuthOrModelChange: (piProfile: string) => Promise<void>;
  onResourceChange: (piProfile: string) => Promise<void>;
  piProfile: string;
  profileRoot: string;
}

type ChangeKind = "auth-or-model" | "resource";

const RESOURCE_DIRS = ["skills", "extensions", "prompts", "themes"] as const;

function getWatchedProfilePaths(profileRoot: string): string[] {
  return [
    join(profileRoot, "settings.json"),
    join(profileRoot, "models.json"),
    join(profileRoot, "auth.json"),
    ...RESOURCE_DIRS.map((dir) => join(profileRoot, dir)),
  ];
}

function classifyProfileChange(profileRoot: string, path: string): ChangeKind {
  if (path === join(profileRoot, "models.json") || path === join(profileRoot, "auth.json")) {
    return "auth-or-model";
  }
  return "resource";
}

export class ProfileWatcher {
  private readonly watcher: FSWatcher;
  private authOrModelTimer: ReturnType<typeof setTimeout> | undefined;
  private resourceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ProfileWatcherOptions) {
    this.watcher = chokidar.watch(getWatchedProfilePaths(options.profileRoot), {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on("add", (path) => this.scheduleReload(path));
    this.watcher.on("addDir", (path) => this.scheduleReload(path));
    this.watcher.on("change", (path) => this.scheduleReload(path));
    this.watcher.on("unlink", (path) => this.scheduleReload(path));
    this.watcher.on("unlinkDir", (path) => this.scheduleReload(path));
    this.watcher.on("error", (error) => {
      console.error("[profile-watcher] watcher error", error);
    });
  }

  private scheduleReload(path: string): void {
    if (classifyProfileChange(this.options.profileRoot, path) === "auth-or-model") {
      if (this.authOrModelTimer) {
        clearTimeout(this.authOrModelTimer);
      }
      this.authOrModelTimer = setTimeout(() => {
        void this.options.onAuthOrModelChange(this.options.piProfile).catch((error) => {
          console.error("[profile-watcher] auth/model reload failed", error);
        });
      }, this.options.debounceMs);
      return;
    }

    if (this.resourceTimer) {
      clearTimeout(this.resourceTimer);
    }
    this.resourceTimer = setTimeout(() => {
      void this.options.onResourceChange(this.options.piProfile).catch((error) => {
        console.error("[profile-watcher] resource reload failed", error);
      });
    }, this.options.debounceMs);
  }

  async dispose(): Promise<void> {
    if (this.authOrModelTimer) {
      clearTimeout(this.authOrModelTimer);
      this.authOrModelTimer = undefined;
    }
    if (this.resourceTimer) {
      clearTimeout(this.resourceTimer);
      this.resourceTimer = undefined;
    }
    await this.watcher.close();
  }
}
