import { loadShellRainingConfigFile, resolveConfig } from "./config/loader.js";

export type { Config, ResolvedAgentConfig, ShellRainingConfigFile } from "./config/schema.js";
export { shellRainingConfigFileSchema } from "./config/schema.js";
export { buildEffectiveConfig, classifyConfigChangePaths } from "./config/changes.js";
export type { ConfigChangeClassification } from "./config/changes.js";

export async function loadConfig() {
  return resolveConfig(await loadShellRainingConfigFile());
}
