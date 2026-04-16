import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when TELEGRAM_BOT_TOKEN is missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow("TELEGRAM_BOT_TOKEN is required");
  });

  it("uses shellRaining defaults", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.workspace).toBe("/mock/home/shellRaining-workspace");
    expect(config.baseDir).toBe("/mock/home/.shellRaining");
    expect(config.agentDir).toBe("/mock/home/.pi/agent");
  });

  it("loads cron storage and timeout defaults", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token";
    delete process.env.SHELL_RAINING_CRON_JOBS_PATH;
    delete process.env.SHELL_RAINING_CRON_RUN_TIMEOUT_MS;
    delete process.env.SHELL_RAINING_CRON_MISFIRE_GRACE_MS;

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.cron.jobsPath).toContain(".shellRaining/cron/jobs.json");
    expect(config.cron.runTimeoutMs).toBe(5 * 60 * 1000);
    expect(config.cron.misfireGraceMs).toBe(5 * 60 * 1000);
  });

  it("uses explicit cron config overrides", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.SHELL_RAINING_CRON_JOBS_PATH = " /tmp/custom-cron/jobs.json ";
    process.env.SHELL_RAINING_CRON_RUN_TIMEOUT_MS = " 120000 ";
    process.env.SHELL_RAINING_CRON_MISFIRE_GRACE_MS = " 45000 ";

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.cron.jobsPath).toBe("/tmp/custom-cron/jobs.json");
    expect(config.cron.runTimeoutMs).toBe(120000);
    expect(config.cron.misfireGraceMs).toBe(45000);
  });

  it("falls back to cron numeric defaults for invalid values", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.SHELL_RAINING_CRON_RUN_TIMEOUT_MS = "not-a-number";
    process.env.SHELL_RAINING_CRON_MISFIRE_GRACE_MS = "   ";

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.cron.runTimeoutMs).toBe(5 * 60 * 1000);
    expect(config.cron.misfireGraceMs).toBe(5 * 60 * 1000);
  });

  it("parses allowed users and custom rate limit", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.SHELL_RAINING_ALLOWED_USERS = "123,456";
    process.env.SHELL_RAINING_RATE_LIMIT_COOLDOWN_MS = "10000";
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.allowedUsers).toEqual([123, 456]);
    expect(config.rateLimitCooldownMs).toBe(10000);
  });

  it("parses optional STT config", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.SHELL_RAINING_STT_BASE_URL = " https://stt.shellraining.xyz/ ";
    process.env.SHELL_RAINING_STT_API_KEY = " stt-secret ";
    process.env.SHELL_RAINING_STT_MODEL = " faster-whisper-large-v3 ";

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.stt).toEqual({
      apiKey: "stt-secret",
      baseUrl: "https://stt.shellraining.xyz",
      model: "faster-whisper-large-v3",
    });
  });

  it("parses optional Telegram API base URL", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_API_BASE_URL = " http://127.0.0.1:8081/ ";

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.telegramApiBaseUrl).toBe("http://127.0.0.1:8081");
  });
});
