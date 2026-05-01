import type { Config } from "./schema.js";

export interface ConfigChangeClassification {
  hot: string[];
  restartRequired: string[];
  unsupported: string[];
}

const hotConfigPaths = new Set([
  "telegram.allowedUsers",
  "telegram.showThinking",
  "stt.apiKey",
  "stt.baseUrl",
  "stt.model",
]);

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
    const key = path.join(".");
    if (hotConfigPaths.has(key)) {
      classification.hot.push(key);
    } else if (restartRequiredConfigPaths.has(key)) {
      classification.restartRequired.push(key);
    } else {
      classification.unsupported.push(key);
    }
  }

  return classification;
}

export function buildEffectiveConfig(
  previous: Config,
  next: Config,
  classification: ConfigChangeClassification,
): Config {
  const effective: Config = {
    agents: { ...previous.agents },
    cron: { ...previous.cron },
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
