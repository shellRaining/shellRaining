import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { createNoopLogger, type Logger } from "../logging/service.js";
import { getAgentPersonaWatchPaths } from "./persona-files.js";

interface ProfileWatcherOptions {
  debounceMs: number;
  logger?: Logger;
  onAuthOrModelChange: (piProfile: string) => Promise<void>;
  onResourceChange: (piProfile: string) => Promise<void>;
  piProfile: string;
  profileRoot: string;
  resourceRoots?: string[];
}

type ChangeKind = "auth-or-model" | "resource";

const RESOURCE_DIRS = ["skills", "extensions", "prompts", "themes"] as const;

function getWatchedProfilePaths(profileRoot: string, resourceRoots: string[] = []): string[] {
  return [
    join(profileRoot, "settings.json"),
    join(profileRoot, "models.json"),
    join(profileRoot, "auth.json"),
    ...RESOURCE_DIRS.map((dir) => join(profileRoot, dir)),
    ...resourceRoots.flatMap((root) => getAgentPersonaWatchPaths(root)),
  ];
}

function classifyProfileChange(profileRoot: string, path: string): ChangeKind {
  if (path === join(profileRoot, "models.json") || path === join(profileRoot, "auth.json")) {
    return "auth-or-model";
  }
  return "resource";
}

export class ProfileWatcher {
  private readonly logger: Logger;
  private readonly watcher: FSWatcher;
  private authOrModelTimer: ReturnType<typeof setTimeout> | undefined;
  private resourceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ProfileWatcherOptions) {
    this.logger = (options.logger ?? createNoopLogger()).child({ component: "profile-watcher" });
    this.watcher = chokidar.watch(getWatchedProfilePaths(options.profileRoot, options.resourceRoots), {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on("add", (path) => {
      this.scheduleReload(path);
    });
    this.watcher.on("addDir", (path) => {
      this.scheduleReload(path);
    });
    this.watcher.on("change", (path) => {
      this.scheduleReload(path);
    });
    this.watcher.on("unlink", (path) => {
      this.scheduleReload(path);
    });
    this.watcher.on("unlinkDir", (path) => {
      this.scheduleReload(path);
    });
    this.watcher.on("error", (error) => {
      this.logger.error(
        { error, event: "watcher.error", piProfile: options.piProfile },
        "profile watcher error",
      );
    });
    this.logger.info(
      { event: "watcher.start", piProfile: options.piProfile },
      "profile watcher started",
    );
  }

  private scheduleReload(path: string): void {
    if (classifyProfileChange(this.options.profileRoot, path) === "auth-or-model") {
      this.logger.debug(
        { event: "profile.auth_model.reload.scheduled", path, piProfile: this.options.piProfile },
        "profile auth/model reload scheduled",
      );
      if (this.authOrModelTimer !== undefined) {
        clearTimeout(this.authOrModelTimer);
      }
      this.authOrModelTimer = setTimeout(() => {
        void this.options.onAuthOrModelChange(this.options.piProfile).catch((error) => {
          this.logger.error(
            { error, event: "profile.auth_model.reload.error", piProfile: this.options.piProfile },
            "profile auth/model reload failed",
          );
        });
      }, this.options.debounceMs);
      return;
    }

    this.logger.debug(
      { event: "profile.resource.reload.scheduled", path, piProfile: this.options.piProfile },
      "profile resource reload scheduled",
    );
    if (this.resourceTimer !== undefined) {
      clearTimeout(this.resourceTimer);
    }
    this.resourceTimer = setTimeout(() => {
      void this.options.onResourceChange(this.options.piProfile).catch((error) => {
        this.logger.error(
          { error, event: "profile.resource.reload.error", piProfile: this.options.piProfile },
          "profile resource reload failed",
        );
      });
    }, this.options.debounceMs);
  }

  async dispose(): Promise<void> {
    if (this.authOrModelTimer !== undefined) {
      clearTimeout(this.authOrModelTimer);
      this.authOrModelTimer = undefined;
    }
    if (this.resourceTimer !== undefined) {
      clearTimeout(this.resourceTimer);
      this.resourceTimer = undefined;
    }
    await this.watcher.close();
    this.logger.info(
      { event: "watcher.stop", piProfile: this.options.piProfile },
      "profile watcher stopped",
    );
  }
}
