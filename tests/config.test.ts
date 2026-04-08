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

  it("uses shell-raining defaults", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.workspace).toBe("/mock/home/shell-raining-workspace");
    expect(config.baseDir).toBe("/mock/home/.shell-raining");
    expect(config.agentDir).toBe("/mock/home/.pi/agent");
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
});
