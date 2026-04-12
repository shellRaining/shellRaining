import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  telegramToken: string;
  telegramWebhookSecret?: string;
  port: number;
  baseDir: string;
  workspace: string;
  agentDir: string;
  skillsDir: string;
  allowedUsers: number[];
  rateLimitCooldownMs: number;
  showThinking: boolean;
  serviceProfile: {
    crawlUrl: string;
    vikunjaUrl: string;
    apiBaseUrl: string;
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
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
    port: Number.parseInt(process.env.SHELL_RAINING_PORT || "3457", 10),
    baseDir,
    workspace,
    agentDir,
    skillsDir,
    allowedUsers,
    rateLimitCooldownMs: Number.parseInt(process.env.SHELL_RAINING_RATE_LIMIT_COOLDOWN_MS || "5000", 10),
    showThinking: parseBoolean(process.env.SHELL_RAINING_SHOW_THINKING, false),
    serviceProfile: {
      crawlUrl: process.env.SHELL_RAINING_CRAWL_URL?.trim() || "https://crawl.shellraining.xyz",
      vikunjaUrl: process.env.SHELL_RAINING_VIKUNJA_URL?.trim() || "https://todo.shellraining.xyz",
      apiBaseUrl: process.env.SHELL_RAINING_API_BASE_URL?.trim() || "https://api.shellraining.xyz",
    },
  };
}
