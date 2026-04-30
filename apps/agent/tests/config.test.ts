import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(() => "/mock/home"),
  };
});

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
    expect(config.defaultAgent).toBe("default");
    expect(config.agents).toEqual({
      default: {
        displayName: "shellRaining",
        id: "default",
        piProfile: "default",
        profileRoot: "/mock/home/.shellRaining/pi-profiles/default",
      },
    });
    expect("agentDir" in config).toBe(false);
    expect("skillsDir" in config).toBe(false);
    expect("providerBaseUrl" in config).toBe(false);
    expect("pi" in config).toBe(false);
  });

  it("derives Pi profile roots from shellRaining-owned agent mappings", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shellraining-config-"));
    const configPath = join(tempDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        telegram: {
          botToken: "file-token",
          defaultAgent: "coder",
        },
        paths: {
          baseDir: join(tempDir, "base"),
        },
        agents: {
          reviewer: {
            displayName: "Reviewer",
            piProfile: "reviewer-profile",
          },
          coder: {
            displayName: "Coder",
            piProfile: "coder-profile",
          },
        },
      }),
    );
    process.env.SHELL_RAINING_CONFIG = configPath;
    delete process.env.TELEGRAM_BOT_TOKEN;

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.defaultAgent).toBe("coder");
    expect(config.agents).toEqual({
      coder: {
        displayName: "Coder",
        id: "coder",
        piProfile: "coder-profile",
        profileRoot: join(tempDir, "base", "pi-profiles", "coder-profile"),
      },
      reviewer: {
        displayName: "Reviewer",
        id: "reviewer",
        piProfile: "reviewer-profile",
        profileRoot: join(tempDir, "base", "pi-profiles", "reviewer-profile"),
      },
    });
  });

  it("rejects unsafe Pi profile ids", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shellraining-config-"));
    const configPath = join(tempDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        telegram: { botToken: "file-token" },
        agents: {
          coder: { piProfile: "../pi" },
        },
      }),
    );
    process.env.SHELL_RAINING_CONFIG = configPath;
    delete process.env.TELEGRAM_BOT_TOKEN;

    const { loadConfig } = await import("../src/config.js");

    expect(() => loadConfig()).toThrow("Invalid Pi profile id");
  });

  it("loads shellRaining config file values", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shellraining-config-"));
    const configPath = join(tempDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        server: { port: 4567 },
        telegram: {
          botToken: "file-token",
          apiBaseUrl: "https://telegram.example.com/",
          webhookSecret: "file-secret",
          allowedUsers: [123, 456],
          showThinking: true,
        },
        paths: {
          baseDir: join(tempDir, "base"),
          workspace: join(tempDir, "workspace"),
        },
        cron: {
          jobsPath: "~/.shellRaining/cron/jobs.json",
          runTimeoutMs: 1000,
          misfireGraceMs: 2000,
        },
        stt: {
          apiKey: "stt-key",
          baseUrl: "https://stt.example.com/",
          model: "whisper-test",
        },
      }),
    );
    process.env.SHELL_RAINING_CONFIG = configPath;
    delete process.env.TELEGRAM_BOT_TOKEN;

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.telegramToken).toBe("file-token");
    expect(config.telegramApiBaseUrl).toBe("https://telegram.example.com");
    expect(config.telegramWebhookSecret).toBe("file-secret");
    expect(config.allowedUsers).toEqual([123, 456]);
    expect(config.port).toBe(4567);
    expect(config.baseDir).toBe(join(tempDir, "base"));
    expect(config.workspace).toBe(join(tempDir, "workspace"));
    expect(config.showThinking).toBe(true);
    expect(config.cron.jobsPath).toBe("/mock/home/.shellRaining/cron/jobs.json");
    expect(config.cron.runTimeoutMs).toBe(1000);
    expect(config.cron.misfireGraceMs).toBe(2000);
    expect(config.stt).toEqual({
      apiKey: "stt-key",
      baseUrl: "https://stt.example.com",
      model: "whisper-test",
    });
  });

  it("lets environment variables override shellRaining config file values", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shellraining-config-"));
    const configPath = join(tempDir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        server: { port: 4567 },
        paths: { baseDir: join(tempDir, "file-base") },
        telegram: { botToken: "file-token", allowedUsers: [123], showThinking: false },
      }),
    );

    process.env.SHELL_RAINING_CONFIG = configPath;
    process.env.TELEGRAM_BOT_TOKEN = "env-token";
    process.env.SHELL_RAINING_PORT = "9876";
    process.env.SHELL_RAINING_BASE_DIR = join(tempDir, "env-base");
    process.env.SHELL_RAINING_ALLOWED_USERS = "789,101";
    process.env.SHELL_RAINING_SHOW_THINKING = "true";

    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();

    expect(config.telegramToken).toBe("env-token");
    expect(config.port).toBe(9876);
    expect(config.baseDir).toBe(join(tempDir, "env-base"));
    expect(config.allowedUsers).toEqual([789, 101]);
    expect(config.showThinking).toBe(true);
    expect(config.agents.default?.profileRoot).toBe(
      join(tempDir, "env-base", "pi-profiles", "default"),
    );
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

  it("parses allowed users", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.SHELL_RAINING_ALLOWED_USERS = "123,456";
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.allowedUsers).toEqual([123, 456]);
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
