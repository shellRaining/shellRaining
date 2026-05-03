import { watchConfig } from "c12";
import { buildEffectiveConfig, classifyConfigChangePaths } from "./changes.js";
import {
  createC12ConfigOptions,
  loadShellRainingConfigFile,
  resolveLoadedConfig,
} from "./loader.js";
import type { Config, ShellRainingConfigFile } from "./schema.js";

function assertIsShellRainingConfigFile(value: unknown): asserts value is ShellRainingConfigFile {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected config to be an object");
  }
}

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
  private listeners = new Set<ConfigListener>();
  private watcher?: ConfigWatcher;

  constructor(initialConfig: Config) {
    this.effectiveConfig = initialConfig;
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
    if (this.watcher !== undefined) {
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
    if (watcher === undefined) {
      return;
    }

    this.watcher = undefined;
    await watcher.unwatch();
  }

  private async handleUpdate(event: ConfigUpdateEvent): Promise<void> {
    let nextLoaded: Config;
    try {
      assertIsShellRainingConfigFile(event.newConfig.config);
      nextLoaded = resolveLoadedConfig(event.newConfig.config);
    } catch (error) {
      console.error("[config-service] invalid watched config", error);
      return;
    }

    const classification = classifyConfigChangePaths(
      event.getDiff().map((entry) => diffEntryToPath(entry)),
    );
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

    const nextEffective = buildEffectiveConfig(this.effectiveConfig, nextLoaded, classification);
    if (JSON.stringify(nextEffective) === JSON.stringify(this.effectiveConfig)) {
      return;
    }

    this.effectiveConfig = nextEffective;
    await Promise.all(
      [...this.listeners].map((listener) => Promise.resolve(listener(nextEffective))),
    );
  }
}

function diffEntryToPath(entry: ConfigDiffEntry): string[] {
  if (entry.path !== undefined) {
    return entry.path;
  }

  return entry.key === undefined ? [] : entry.key.split(".");
}

export async function createConfigService(): Promise<ConfigService> {
  return new ConfigService(resolveLoadedConfig(await loadShellRainingConfigFile()));
}
