import chokidar, { type FSWatcher } from "chokidar";
import { createNoopLogger, type Logger } from "../logging/service.js";

interface SkillWatcherOptions {
  paths: string[];
  debounceMs: number;
  logger?: Logger;
  onReload: () => Promise<void>;
}

export class SkillWatcher {
  private readonly logger: Logger;
  private readonly watcher: FSWatcher;
  private readonly watchedPaths = new Set<string>();
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: SkillWatcherOptions) {
    this.logger = (options.logger ?? createNoopLogger()).child({ component: "skill-watcher" });
    this.watchedPaths = new Set(options.paths);
    this.watcher = chokidar.watch([...this.watchedPaths], {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on("add", () => {
      this.scheduleReload();
    });
    this.watcher.on("change", () => {
      this.scheduleReload();
    });
    this.watcher.on("unlink", () => {
      this.scheduleReload();
    });
    this.watcher.on("error", (error) => {
      this.logger.error({ error, event: "watcher.error" }, "skill watcher error");
    });
    this.logger.info(
      { event: "watcher.start", paths: [...this.watchedPaths] },
      "skill watcher started",
    );
  }

  addPath(path: string): void {
    if (this.watchedPaths.has(path)) {
      return;
    }

    this.watchedPaths.add(path);
    this.watcher.add(path);
    this.logger.info({ event: "watcher.path.add", path }, "skill watcher path added");
  }

  private scheduleReload(): void {
    this.logger.debug({ event: "skill.reload.scheduled" }, "skill reload scheduled");
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }

    this.reloadTimer = setTimeout(() => {
      void this.options.onReload().catch((error) => {
        this.logger.error({ error, event: "skill.reload.error" }, "skill reload failed");
      });
    }, this.options.debounceMs);
  }

  async dispose(): Promise<void> {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }

    await this.watcher.close();
    this.logger.info({ event: "watcher.stop" }, "skill watcher stopped");
  }
}
