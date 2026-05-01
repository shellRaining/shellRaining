import { watchConfig } from "c12";
import { buildEffectiveConfig, classifyConfigChangePaths } from "./changes.js";
import {
  createC12ConfigOptions,
  loadShellRainingConfigFile,
  resolveLoadedConfig,
} from "./loader.js";
import type { Config, ShellRainingConfigFile } from "./schema.js";

type ConfigListener = (config: Config) => void | Promise<void>;

type ConfigDiffEntry = {
  path?: string[];
  key?: string;
};

type ConfigUpdateEvent = {
  newConfig: { config: unknown };
  getDiff: () => ConfigDiffEntry[];
};

type ConfigWatcher = {
  unwatch: () => void | Promise<void>;
};

export class ConfigService {
  private effectiveConfig: Config;
  private loadedConfig: Config;
  private listeners = new Set<ConfigListener>();
  private watcher?: ConfigWatcher;

  constructor(initialConfig: Config) {
    this.effectiveConfig = initialConfig;
    this.loadedConfig = initialConfig;
  }

  current(): Config {
    return this.effectiveConfig;
  }

  subscribe(listener: ConfigListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.watcher) {
      return;
    }

    this.watcher = await watchConfig<ShellRainingConfigFile>({
      ...createC12ConfigOptions(),
      onUpdate: async (event: ConfigUpdateEvent) => {
        await this.handleUpdate(event);
      },
    });
  }

  async stop(): Promise<void> {
    const watcher = this.watcher;
    if (!watcher) {
      return;
    }

    this.watcher = undefined;
    await watcher.unwatch();
  }

  private async handleUpdate(event: ConfigUpdateEvent): Promise<void> {
    let nextLoaded: Config;
    try {
      nextLoaded = resolveLoadedConfig(event.newConfig.config as ShellRainingConfigFile);
    } catch (error) {
      console.error("[config-service] invalid watched config", error);
      return;
    }

    const classification = classifyConfigChangePaths(event.getDiff().map(diffEntryToPath));
    if (classification.restartRequired.length > 0) {
      console.error(
        `[config-service] restart required for config paths: ${classification.restartRequired.join(", ")}`,
      );
    }
    if (classification.unsupported.length > 0) {
      console.error(
        `[config-service] unsupported config paths changed: ${classification.unsupported.join(", ")}`,
      );
    }

    this.loadedConfig = nextLoaded;
    const nextEffective = buildEffectiveConfig(this.effectiveConfig, nextLoaded, classification);
    if (JSON.stringify(nextEffective) === JSON.stringify(this.effectiveConfig)) {
      return;
    }

    this.effectiveConfig = nextEffective;
    await Promise.all([...this.listeners].map((listener) => listener(nextEffective)));
  }
}

function diffEntryToPath(entry: ConfigDiffEntry): string[] {
  if (entry.path) {
    return entry.path;
  }

  return entry.key ? entry.key.split(".") : [];
}

export async function createConfigService(): Promise<ConfigService> {
  return new ConfigService(resolveLoadedConfig(await loadShellRainingConfigFile()));
}
