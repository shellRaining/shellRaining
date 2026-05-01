import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { loadConfig as loadC12Config, type LoadConfigOptions } from "c12";
import { resolveAgents, resolveDefaultAgent } from "./agents.js";
import { buildEnvOverrides } from "./env.js";
import { mergeConfigLayers } from "./merge.js";
import { expandHome, trimTrailingSlashes } from "./path.js";
import {
  shellRainingConfigDefaults,
  shellRainingConfigFileSchema,
  type Config,
  type ShellRainingConfigFile,
} from "./schema.js";
import { resolveConfigValue } from "./values.js";

export function getShellRainingConfigPath(): { configured: boolean; path: string } {
  const configuredConfigPath = process.env.SHELL_RAINING_CONFIG?.trim();
  return {
    configured: Boolean(configuredConfigPath),
    path: expandHome(configuredConfigPath || join(homedir(), ".shellRaining", "config.json")),
  };
}

export function createC12ConfigOptions(
  configPath = getShellRainingConfigPath(),
): LoadConfigOptions<ShellRainingConfigFile> {
  return {
    configFile: configPath.path,
    configFileRequired: configPath.configured,
    cwd: dirname(configPath.path),
    defaults: shellRainingConfigDefaults,
    dotenv: {
      fileName: ".env",
    },
    envName: false,
    globalRc: false,
    merger: mergeConfigLayers,
    // Keep this lazy so C12 loads .env before we map process.env into typed overrides.
    overrides: () => buildEnvOverrides(),
    packageJson: false,
    rcFile: false,
  };
}

export function validateConfigFile(
  config: ShellRainingConfigFile,
  configPath = getShellRainingConfigPath().path,
): ShellRainingConfigFile {
  const errors = [...Value.Errors(shellRainingConfigFileSchema, config)];
  if (errors.length > 0) {
    const details = errors.map((error) => `${error.path || "/"}: ${error.message}`).join("; ");
    throw new Error(`Invalid shellRaining config file ${configPath}: ${details}`);
  }

  return config;
}

export function resolveConfig(fileConfig: ShellRainingConfigFile): Config {
  const token = resolveConfigValue(fileConfig.telegram?.botToken);
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required. Set it in .env file.");
  }

  const home = homedir();
  const baseDir = expandHome(fileConfig.paths?.baseDir ?? join(home, ".shellRaining"), home);
  const workspace = expandHome(
    fileConfig.paths?.workspace ?? join(home, "shellRaining-workspace"),
    home,
  );
  const agents = resolveAgents(fileConfig.agents, baseDir);
  const defaultAgent = resolveDefaultAgent(fileConfig.telegram?.defaultAgent, agents);
  const port = fileConfig.server?.port ?? 3457;

  return {
    server: {
      port,
    },
    telegram: {
      botToken: token,
      apiBaseUrl: fileConfig.telegram?.apiBaseUrl
        ? trimTrailingSlashes(fileConfig.telegram.apiBaseUrl)
        : undefined,
      webhookSecret: fileConfig.telegram?.webhookSecret,
      allowedUsers: fileConfig.telegram?.allowedUsers ?? [],
      defaultAgent,
      showThinking: fileConfig.telegram?.showThinking ?? false,
    },
    paths: {
      baseDir,
      workspace,
    },
    agents,
    cron: {
      jobsPath: expandHome(
        resolveConfigValue(fileConfig.cron?.jobsPath) || join(baseDir, "cron", "jobs.json"),
        home,
      ),
      runTimeoutMs: fileConfig.cron?.runTimeoutMs ?? 5 * 60 * 1000,
      misfireGraceMs: fileConfig.cron?.misfireGraceMs ?? 5 * 60 * 1000,
    },
    stt: {
      apiKey: fileConfig.stt?.apiKey,
      baseUrl: fileConfig.stt?.baseUrl ? trimTrailingSlashes(fileConfig.stt.baseUrl) : undefined,
      model: fileConfig.stt?.model,
    },
  };
}

export function resolveLoadedConfig(fileConfig: ShellRainingConfigFile): Config {
  return resolveConfig(validateConfigFile(fileConfig));
}

export async function loadShellRainingConfigFile(): Promise<ShellRainingConfigFile> {
  const configPath = getShellRainingConfigPath();
  if (configPath.configured && !existsSync(configPath.path)) {
    throw new Error(`shellRaining config file not found: ${configPath.path}`);
  }

  const { config } = await loadC12Config<ShellRainingConfigFile>(
    createC12ConfigOptions(configPath),
  );
  return validateConfigFile(config, configPath.path);
}
