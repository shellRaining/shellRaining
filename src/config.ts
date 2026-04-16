import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  telegramToken: string;
  telegramApiBaseUrl?: string;
  telegramWebhookSecret?: string;
  port: number;
  baseDir: string;
  workspace: string;
  agentDir: string;
  skillsDir: string;
  allowedUsers: number[];
  rateLimitCooldownMs: number;
  showThinking: boolean;
  cron: {
    jobsPath: string;
    runTimeoutMs: number;
    misfireGraceMs: number;
  };
  stt: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  serviceProfile: {
    crawlUrl: string;
    vikunjaUrl: string;
    apiBaseUrl: string;
  };
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
  const workspace = process.env.SHELL_RAINING_WORKSPACE?.trim() || join(home, "shellRaining-workspace");
  const agentDir = process.env.SHELL_RAINING_AGENT_DIR?.trim() || join(home, ".pi", "agent");
  const skillsDir = process.env.SHELL_RAINING_SKILLS_DIR?.trim() || join(home, "Documents", "dotfiles", "skills");
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
    rateLimitCooldownMs: Number.parseInt(process.env.SHELL_RAINING_RATE_LIMIT_COOLDOWN_MS || "5000", 10),
    showThinking: parseBoolean(process.env.SHELL_RAINING_SHOW_THINKING, false),
    cron: {
      jobsPath: process.env.SHELL_RAINING_CRON_JOBS_PATH?.trim() || join(baseDir, "cron", "jobs.json"),
      runTimeoutMs: parseCronNumber(process.env.SHELL_RAINING_CRON_RUN_TIMEOUT_MS, 5 * 60 * 1000),
      misfireGraceMs: parseCronNumber(process.env.SHELL_RAINING_CRON_MISFIRE_GRACE_MS, 5 * 60 * 1000),
    },
    stt: {
      apiKey: process.env.SHELL_RAINING_STT_API_KEY?.trim() || undefined,
      baseUrl: process.env.SHELL_RAINING_STT_BASE_URL?.trim()
        ? trimTrailingSlashes(process.env.SHELL_RAINING_STT_BASE_URL.trim())
        : undefined,
      model: process.env.SHELL_RAINING_STT_MODEL?.trim() || undefined,
    },
    serviceProfile: {
      crawlUrl: process.env.SHELL_RAINING_CRAWL_URL?.trim() || "https://crawl.shellraining.xyz",
      vikunjaUrl: process.env.SHELL_RAINING_VIKUNJA_URL?.trim() || "https://todo.shellraining.xyz",
      apiBaseUrl: process.env.SHELL_RAINING_API_BASE_URL?.trim() || "https://api.shellraining.xyz",
    },
    providerBaseUrl: process.env.SHELL_RAINING_PROVIDER_BASE_URL?.trim()
      ? trimTrailingSlashes(process.env.SHELL_RAINING_PROVIDER_BASE_URL.trim())
      : undefined,
  };
}
