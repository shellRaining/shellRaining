import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Application configuration loaded from environment variables (or `.env` file). */
export interface Config {
  /** Telegram Bot API token. **Required.** */
  telegramToken: string;
  /** Custom Telegram Bot API base URL (e.g. for a local Bot API server). */
  telegramApiBaseUrl?: string;
  /** Secret for verifying incoming webhook requests. */
  telegramWebhookSecret?: string;
  /** HTTP server listen port. @defaultValue 3457 */
  port: number;
  /** Root directory for persistent shellRaining data (sessions, cron store, etc.). */
  baseDir: string;
  /** Directory where Pi agent workspaces are created (per-thread subdirectories). */
  workspace: string;
  /** Path to the Pi agent configuration directory. */
  agentDir: string;
  /** Path to the skills directory synced into Pi's `settings.json`. */
  skillsDir: string;
  /** Telegram user IDs allowed to interact with the bot. Empty = all users blocked. */
  allowedUsers: number[];
  /** Whether to include the agent's thinking output in Telegram replies. @defaultValue false */
  showThinking: boolean;
  cron: {
    /** File path for persisting cron jobs to disk. */
    jobsPath: string;
    /** Maximum wall-clock time (ms) for a single cron prompt execution. @defaultValue 300000 (5 min) */
    runTimeoutMs: number;
    /** If a job missed its scheduled time by less than this window (ms), run it anyway. @defaultValue 300000 (5 min) */
    misfireGraceMs: number;
  };
  /** Speech-to-text (Whisper-compatible) configuration for transcribing voice messages. */
  stt: {
    /** API key for the STT service. */
    apiKey?: string;
    /** Base URL of the Whisper-compatible STT endpoint. */
    baseUrl?: string;
    /** Model name to request from the STT service. */
    model?: string;
  };
  /** Override base URL for the LLM provider (e.g. for a proxy or compatible API). */
  providerBaseUrl?: string;
  /** Pi-compatible files owned by shellRaining's agent directory. */
  pi: {
    settingsPath: string;
    authPath: string;
    modelsPath: string;
  };
}

interface ShellRainingConfigFile {
  server?: {
    port?: number;
  };
  telegram?: {
    botToken?: string;
    apiBaseUrl?: string;
    webhookSecret?: string;
    allowedUsers?: number[];
  };
  paths?: {
    baseDir?: string;
    workspace?: string;
    agentDir?: string;
    skillsDir?: string;
  };
  agent?: {
    showThinking?: boolean;
    providerBaseUrl?: string;
  };
  cron?: {
    jobsPath?: string;
    runTimeoutMs?: number;
    misfireGraceMs?: number;
  };
  stt?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return defaultValue;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end--;
  }
  return value.slice(0, end);
}

function expandHome(path: string, home = homedir()): string {
  if (path === "~") {
    return home;
  }
  if (path.startsWith("~/")) {
    return join(home, path.slice(2));
  }
  return path;
}

function resolveConfigValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("env:")) {
    return process.env[trimmed.slice("env:".length)]?.trim() || undefined;
  }

  return trimmed;
}

function firstString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const resolved = resolveConfigValue(value);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function firstNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function loadConfigFile(): ShellRainingConfigFile {
  const configPath = expandHome(
    process.env.SHELL_RAINING_CONFIG?.trim() || join(homedir(), ".shellRaining", "config.json"),
  );
  if (!existsSync(configPath)) {
    return {};
  }

  return JSON.parse(readFileSync(configPath, "utf-8")) as ShellRainingConfigFile;
}

function parseCronNumber(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function loadConfig(): Config {
  const fileConfig = loadConfigFile();
  const token = firstString(process.env.TELEGRAM_BOT_TOKEN, fileConfig.telegram?.botToken);
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required. Set it in .env file.");
  }

  const home = homedir();
  const baseDir = expandHome(
    firstString(process.env.SHELL_RAINING_BASE_DIR, fileConfig.paths?.baseDir) ||
      join(home, ".shellRaining"),
    home,
  );
  const workspace = expandHome(
    firstString(process.env.SHELL_RAINING_WORKSPACE, fileConfig.paths?.workspace) ||
      join(home, "shellRaining-workspace"),
    home,
  );
  const agentDir = expandHome(
    firstString(process.env.SHELL_RAINING_AGENT_DIR, fileConfig.paths?.agentDir) ||
      join(baseDir, "agent"),
    home,
  );
  const skillsDir = expandHome(
    firstString(process.env.SHELL_RAINING_SKILLS_DIR, fileConfig.paths?.skillsDir) ||
      join(home, "Documents", "dotfiles", "skills"),
    home,
  );
  const allowedUsers = process.env.SHELL_RAINING_ALLOWED_USERS?.trim()
    ? process.env.SHELL_RAINING_ALLOWED_USERS.split(",")
        .map((id) => Number.parseInt(id.trim(), 10))
        .filter((id) => !Number.isNaN(id))
    : fileConfig.telegram?.allowedUsers ?? [];
  const port = process.env.SHELL_RAINING_PORT
    ? Number.parseInt(process.env.SHELL_RAINING_PORT, 10)
    : firstNumber(fileConfig.server?.port) ?? 3457;

  return {
    telegramToken: token,
    telegramApiBaseUrl: firstString(
      process.env.TELEGRAM_API_BASE_URL,
      fileConfig.telegram?.apiBaseUrl,
    )
      ? trimTrailingSlashes(
          firstString(process.env.TELEGRAM_API_BASE_URL, fileConfig.telegram?.apiBaseUrl) ?? "",
        )
      : undefined,
    telegramWebhookSecret: firstString(
      process.env.TELEGRAM_WEBHOOK_SECRET,
      fileConfig.telegram?.webhookSecret,
    ),
    port,
    baseDir,
    workspace,
    agentDir,
    skillsDir,
    allowedUsers,
    showThinking: parseBoolean(
      process.env.SHELL_RAINING_SHOW_THINKING,
      fileConfig.agent?.showThinking ?? false,
    ),
    cron: {
      jobsPath: expandHome(
        firstString(process.env.SHELL_RAINING_CRON_JOBS_PATH, fileConfig.cron?.jobsPath) ||
          join(baseDir, "cron", "jobs.json"),
        home,
      ),
      runTimeoutMs: parseCronNumber(
        process.env.SHELL_RAINING_CRON_RUN_TIMEOUT_MS,
        firstNumber(fileConfig.cron?.runTimeoutMs) ?? 5 * 60 * 1000,
      ),
      misfireGraceMs: parseCronNumber(
        process.env.SHELL_RAINING_CRON_MISFIRE_GRACE_MS,
        firstNumber(fileConfig.cron?.misfireGraceMs) ?? 5 * 60 * 1000,
      ),
    },
    stt: {
      apiKey: firstString(process.env.SHELL_RAINING_STT_API_KEY, fileConfig.stt?.apiKey),
      baseUrl: firstString(process.env.SHELL_RAINING_STT_BASE_URL, fileConfig.stt?.baseUrl)
        ? trimTrailingSlashes(
            firstString(process.env.SHELL_RAINING_STT_BASE_URL, fileConfig.stt?.baseUrl) ?? "",
          )
        : undefined,
      model: firstString(process.env.SHELL_RAINING_STT_MODEL, fileConfig.stt?.model),
    },
    providerBaseUrl: firstString(
      process.env.SHELL_RAINING_PROVIDER_BASE_URL,
      fileConfig.agent?.providerBaseUrl,
    )
      ? trimTrailingSlashes(
          firstString(process.env.SHELL_RAINING_PROVIDER_BASE_URL, fileConfig.agent?.providerBaseUrl) ??
            "",
        )
      : undefined,
    pi: {
      settingsPath: join(agentDir, "settings.json"),
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
    },
  };
}
