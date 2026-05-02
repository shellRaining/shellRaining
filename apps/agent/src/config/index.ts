import { loadShellRainingConfigFile, resolveConfig } from "./loader.js";
import type { Config } from "./schema.js";

export type { Config, ResolvedAgentConfig, ShellRainingConfigFile } from "./schema.js";
export { shellRainingConfigFileSchema } from "./schema.js";
export { buildEffectiveConfig, classifyConfigChangePaths } from "./changes.js";
export type { ConfigChangeClassification } from "./changes.js";
export { ConfigService, createConfigService } from "./service.js";

export type ConfigSource = Config | (() => Config);

export function readConfig(source: ConfigSource): Config {
  return typeof source === "function" ? source() : source;
}

export async function loadConfig() {
  return resolveConfig(await loadShellRainingConfigFile());
}
