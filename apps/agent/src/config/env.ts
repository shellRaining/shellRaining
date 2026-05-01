import type { ShellRainingConfigFile } from "./schema.js";
import {
  parseOptionalAllowedUsers,
  parseOptionalBoolean,
  parseOptionalNumber,
  resolveConfigValue,
} from "./values.js";

export function buildEnvOverrides(): ShellRainingConfigFile {
  return {
    cron: {
      jobsPath: resolveConfigValue(process.env.SHELL_RAINING_CRON_JOBS_PATH),
      misfireGraceMs: parseOptionalNumber(process.env.SHELL_RAINING_CRON_MISFIRE_GRACE_MS),
      runTimeoutMs: parseOptionalNumber(process.env.SHELL_RAINING_CRON_RUN_TIMEOUT_MS),
    },
    paths: {
      baseDir: resolveConfigValue(process.env.SHELL_RAINING_BASE_DIR),
      workspace: resolveConfigValue(process.env.SHELL_RAINING_WORKSPACE),
    },
    server: {
      port: parseOptionalNumber(process.env.SHELL_RAINING_PORT),
    },
    stt: {
      apiKey: resolveConfigValue(process.env.SHELL_RAINING_STT_API_KEY),
      baseUrl: resolveConfigValue(process.env.SHELL_RAINING_STT_BASE_URL),
      model: resolveConfigValue(process.env.SHELL_RAINING_STT_MODEL),
    },
    telegram: {
      allowedUsers: parseOptionalAllowedUsers(process.env.SHELL_RAINING_ALLOWED_USERS),
      apiBaseUrl: resolveConfigValue(process.env.TELEGRAM_API_BASE_URL),
      botToken: resolveConfigValue(process.env.TELEGRAM_BOT_TOKEN),
      showThinking: parseOptionalBoolean(process.env.SHELL_RAINING_SHOW_THINKING),
      webhookSecret: resolveConfigValue(process.env.TELEGRAM_WEBHOOK_SECRET),
    },
  };
}
