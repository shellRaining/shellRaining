import type { Config } from "./schema.js";

export interface ConfigChangeClassification {
  hot: string[];
  restartRequired: string[];
  unsupported: string[];
}

const hotConfigPaths = new Set([
  "telegram.allowedUsers",
  "telegram.showThinking",
  "logging.level",
  "stt.apiKey",
  "stt.baseUrl",
  "stt.model",
]);

const hotConfigPathExpansions = new Map([["stt", ["stt.apiKey", "stt.baseUrl", "stt.model"]]]);

const restartRequiredConfigPaths = new Set([
  "server.port",
  "telegram.botToken",
  "telegram.apiBaseUrl",
  "telegram.webhookSecret",
  "telegram.defaultAgent",
  "paths.baseDir",
  "paths.workspace",
  "agents",
  "cron.jobsPath",
  "cron.runTimeoutMs",
  "cron.misfireGraceMs",
  "logging.file.enabled",
  "logging.file.path",
  "logging.file.frequency",
  "logging.file.limit",
  "logging.file.mkdir",
]);

export function classifyConfigChangePaths(
  paths: Array<readonly string[]>,
): ConfigChangeClassification {
  const classification: ConfigChangeClassification = {
    hot: [],
    restartRequired: [],
    unsupported: [],
  };

  for (const path of paths) {
    const key = normalizeConfigChangePath(path);
    if (key === undefined) {
      classification.unsupported.push(path.join("."));
    } else if (hotConfigPathExpansions.has(key)) {
      for (const expandedKey of hotConfigPathExpansions.get(key) ?? []) {
        if (!classification.hot.includes(expandedKey)) {
          classification.hot.push(expandedKey);
        }
      }
    } else if (hotConfigPaths.has(key) && !classification.hot.includes(key)) {
      classification.hot.push(key);
    } else if (
      restartRequiredConfigPaths.has(key) &&
      !classification.restartRequired.includes(key)
    ) {
      classification.restartRequired.push(key);
    }
  }

  return classification;
}

function normalizeConfigChangePath(path: readonly string[]): string | undefined {
  for (let length = path.length; length > 0; length -= 1) {
    const key = path.slice(0, length).join(".");
    if (
      hotConfigPaths.has(key) ||
      (length === path.length && hotConfigPathExpansions.has(key)) ||
      restartRequiredConfigPaths.has(key)
    ) {
      return key;
    }
  }

  return undefined;
}

export function buildEffectiveConfig(
  previous: Config,
  next: Config,
  classification: ConfigChangeClassification,
): Config {
  const effective: Config = {
    agents: Object.fromEntries(
      Object.entries(previous.agents).map(([id, agent]) => [
        id,
        { ...agent, aliases: [...agent.aliases] },
      ]),
    ),
    cron: { ...previous.cron },
    logging: { ...previous.logging, file: { ...previous.logging.file } },
    paths: { ...previous.paths },
    server: { ...previous.server },
    stt: { ...previous.stt },
    telegram: { ...previous.telegram, allowedUsers: [...previous.telegram.allowedUsers] },
  };

  for (const key of classification.hot) {
    if (key === "telegram.allowedUsers") {
      effective.telegram.allowedUsers = [...next.telegram.allowedUsers];
    } else if (key === "telegram.showThinking") {
      effective.telegram.showThinking = next.telegram.showThinking;
    } else if (key === "logging.level") {
      effective.logging.level = next.logging.level;
    } else if (key === "stt.apiKey") {
      effective.stt.apiKey = next.stt.apiKey;
    } else if (key === "stt.baseUrl") {
      effective.stt.baseUrl = next.stt.baseUrl;
    } else if (key === "stt.model") {
      effective.stt.model = next.stt.model;
    }
  }

  return effective;
}
