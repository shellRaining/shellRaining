import type { ShellRainingConfigFile } from "./schema.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConfigValue(target: unknown, source: unknown): unknown {
  if (source === undefined) {
    return target;
  }
  if (Array.isArray(source)) {
    // Config layers are overrides, not additive defaults. This intentionally differs from
    // defu's default array concatenation so env-provided allowlists replace file allowlists.
    return source;
  }
  if (isPlainObject(source)) {
    const merged: Record<string, unknown> = isPlainObject(target) ? { ...target } : {};
    for (const [key, value] of Object.entries(source)) {
      merged[key] = mergeConfigValue(merged[key], value);
    }
    return merged;
  }
  return source;
}

export function mergeConfigLayers(...configs: unknown[]): ShellRainingConfigFile {
  let merged: unknown = {};
  for (let index = configs.length - 1; index >= 0; index--) {
    merged = mergeConfigValue(merged, configs[index]);
  }
  return merged as ShellRainingConfigFile;
}
