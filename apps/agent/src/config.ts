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

function parseCronNumber(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function loadConfig(): Config {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required. Set it in .env file.");
  }

  const home = homedir();
  const baseDir = process.env.SHELL_RAINING_BASE_DIR?.trim() || join(home, ".shellRaining");
  const workspace =
    process.env.SHELL_RAINING_WORKSPACE?.trim() || join(home, "shellRaining-workspace");
  const agentDir = process.env.SHELL_RAINING_AGENT_DIR?.trim() || join(home, ".pi", "agent");
  const skillsDir =
    process.env.SHELL_RAINING_SKILLS_DIR?.trim() || join(home, "Documents", "dotfiles", "skills");
  const allowedUsers = process.env.SHELL_RAINING_ALLOWED_USERS?.trim()
    ? process.env.SHELL_RAINING_ALLOWED_USERS.split(",")
        .map((id) => Number.parseInt(id.trim(), 10))
        .filter((id) => !Number.isNaN(id))
    : [];

  return {
    telegramToken: token,
    telegramApiBaseUrl: process.env.TELEGRAM_API_BASE_URL?.trim()
      ? trimTrailingSlashes(process.env.TELEGRAM_API_BASE_URL.trim())
      : undefined,
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
    port: Number.parseInt(process.env.SHELL_RAINING_PORT || "3457", 10),
    baseDir,
    workspace,
    agentDir,
    skillsDir,
    allowedUsers,
    showThinking: parseBoolean(process.env.SHELL_RAINING_SHOW_THINKING, false),
    cron: {
      jobsPath:
        process.env.SHELL_RAINING_CRON_JOBS_PATH?.trim() || join(baseDir, "cron", "jobs.json"),
      runTimeoutMs: parseCronNumber(process.env.SHELL_RAINING_CRON_RUN_TIMEOUT_MS, 5 * 60 * 1000),
      misfireGraceMs: parseCronNumber(
        process.env.SHELL_RAINING_CRON_MISFIRE_GRACE_MS,
        5 * 60 * 1000,
      ),
    },
    stt: {
      apiKey: process.env.SHELL_RAINING_STT_API_KEY?.trim() || undefined,
      baseUrl: process.env.SHELL_RAINING_STT_BASE_URL?.trim()
        ? trimTrailingSlashes(process.env.SHELL_RAINING_STT_BASE_URL.trim())
        : undefined,
      model: process.env.SHELL_RAINING_STT_MODEL?.trim() || undefined,
    },
    providerBaseUrl: process.env.SHELL_RAINING_PROVIDER_BASE_URL?.trim()
      ? trimTrailingSlashes(process.env.SHELL_RAINING_PROVIDER_BASE_URL.trim())
      : undefined,
  };
}
