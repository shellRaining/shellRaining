import chokidar, { type FSWatcher } from "chokidar";

interface SkillWatcherOptions {
  paths: string[];
  debounceMs: number;
  onReload: () => Promise<void>;
}

export class SkillWatcher {
  private readonly watcher: FSWatcher;
  private readonly watchedPaths = new Set<string>();
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: SkillWatcherOptions) {
    this.watchedPaths = new Set(options.paths);
    this.watcher = chokidar.watch([...this.watchedPaths], {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on("add", () => this.scheduleReload());
    this.watcher.on("change", () => this.scheduleReload());
    this.watcher.on("unlink", () => this.scheduleReload());
    this.watcher.on("error", (error) => {
      console.error("[skill-watcher] watcher error", error);
    });
  }

  async addPath(path: string): Promise<void> {
    if (this.watchedPaths.has(path)) {
      return;
    }

    this.watchedPaths.add(path);
    await this.watcher.add(path);
  }

  private scheduleReload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }

    this.reloadTimer = setTimeout(() => {
      void this.options.onReload().catch((error) => {
        console.error("[skill-watcher] reload failed", error);
      });
    }, this.options.debounceMs);
  }

  async dispose(): Promise<void> {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }

    await this.watcher.close();
  }
}
