import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { loadConfig as loadC12Config } from "c12";
import { resolveAgents, resolveDefaultAgent } from "./config/agents.js";
import { buildEnvOverrides } from "./config/env.js";
import { mergeConfigLayers } from "./config/merge.js";
import { expandHome, trimTrailingSlashes } from "./config/path.js";
import {
  shellRainingConfigDefaults,
  shellRainingConfigFileSchema,
  type Config,
  type ShellRainingConfigFile,
} from "./config/schema.js";
import { resolveConfigValue } from "./config/values.js";

export type { Config, ResolvedAgentConfig, ShellRainingConfigFile } from "./config/schema.js";
export { shellRainingConfigFileSchema } from "./config/schema.js";

async function loadConfigFile(): Promise<ShellRainingConfigFile> {
  const configuredConfigPath = process.env.SHELL_RAINING_CONFIG?.trim();
  const configPath = expandHome(
    configuredConfigPath || join(homedir(), ".shellRaining", "config.json"),
  );
  if (configuredConfigPath && !existsSync(configPath)) {
    throw new Error(`shellRaining config file not found: ${configPath}`);
  }

  const { config } = await loadC12Config<ShellRainingConfigFile>({
    configFile: configPath,
    configFileRequired: Boolean(configuredConfigPath),
    cwd: dirname(configPath),
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
  });

  const errors = [...Value.Errors(shellRainingConfigFileSchema, config)];
  if (errors.length > 0) {
    const details = errors.map((error) => `${error.path || "/"}: ${error.message}`).join("; ");
    throw new Error(`Invalid shellRaining config file ${configPath}: ${details}`);
  }

  return config;
}

export async function loadConfig(): Promise<Config> {
  const fileConfig = await loadConfigFile();
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
