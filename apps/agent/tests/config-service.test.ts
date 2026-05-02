import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type WatchHandlers = {
  onUpdate?: (event: {
    oldConfig: { config: unknown };
    newConfig: { config: unknown };
    getDiff: () => Array<{ path?: string[]; key?: string; toJSON?: () => unknown }>;
  }) => void | Promise<void>;
};

const unwatch = vi.fn(async () => undefined);
const watchHandlers: WatchHandlers = {};
const loadConfigMock = vi.fn();
const watchConfigMock = vi.fn(async (options: WatchHandlers & Record<string, unknown>) => {
  watchHandlers.onUpdate = options.onUpdate;
  return { config: options.defaults, unwatch, watchingFiles: ["/config.json"] };
});

vi.mock("c12", () => ({
  loadConfig: loadConfigMock,
  watchConfig: watchConfigMock,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(() => process.env.SHELL_RAINING_TEST_HOME || "/mock/home"),
  };
});

function fileConfig(overrides: Record<string, unknown> = {}) {
  return {
    telegram: { botToken: "token", allowedUsers: [1], showThinking: false },
    ...overrides,
  };
}

async function useTempConfig() {
  const tempDir = await mkdtemp(join(tmpdir(), "shellraining-config-service-"));
  const configPath = join(tempDir, "config.json");
  await writeFile(configPath, JSON.stringify({ telegram: { botToken: "token" } }));
  process.env.SHELL_RAINING_CONFIG = configPath;
}

describe("config service", () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete watchHandlers.onUpdate;
    await useTempConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("starts with the same resolved config as loadConfig", async () => {
    loadConfigMock.mockResolvedValue({ config: fileConfig() });

    const { createConfigService, loadConfig } = await import("../src/config/index.js");

    const loaded = await loadConfig();
    const service = await createConfigService();

    expect(service.current()).toEqual(loaded);
  });

  it("applies hot changes and keeps restart-required values effective", async () => {
    loadConfigMock.mockResolvedValue({
      config: fileConfig({ server: { port: 3457 }, stt: { model: "old-model" } }),
    });
    const { createConfigService } = await import("../src/config/index.js");
    const service = await createConfigService();
    await service.start();
    const listener = vi.fn(async () => undefined);
    service.subscribe(listener);

    await watchHandlers.onUpdate?.({
      oldConfig: { config: fileConfig() },
      newConfig: {
        config: fileConfig({
          server: { port: 4567 },
          telegram: { botToken: "next-token", allowedUsers: [2, 3], showThinking: true },
          stt: { model: "next-model" },
        }),
      },
      getDiff: () => [
        { path: ["server", "port"] },
        { path: ["telegram", "botToken"] },
        { path: ["telegram", "allowedUsers", "0"] },
        { key: "telegram.showThinking" },
        { path: ["stt", "model"] },
      ],
    });

    expect(service.current().server.port).toBe(3457);
    expect(service.current().telegram.botToken).toBe("token");
    expect(service.current().telegram.allowedUsers).toEqual([2, 3]);
    expect(service.current().telegram.showThinking).toBe(true);
    expect(service.current().stt.model).toBe("next-model");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(service.current());
  });

  it("stops the C12 watcher", async () => {
    loadConfigMock.mockResolvedValue({ config: fileConfig() });
    const { createConfigService } = await import("../src/config/index.js");
    const service = await createConfigService();
    await service.start();

    await service.stop();
    await service.stop();

    expect(unwatch).toHaveBeenCalledTimes(1);
  });

  it("keeps current config and subscribers silent when watched config is invalid", async () => {
    loadConfigMock.mockResolvedValue({ config: fileConfig() });
    const { createConfigService } = await import("../src/config/index.js");
    const service = await createConfigService();
    await service.start();
    const previous = service.current();
    const listener = vi.fn();
    service.subscribe(listener);

    await watchHandlers.onUpdate?.({
      oldConfig: { config: fileConfig() },
      newConfig: { config: fileConfig({ pi: { settingsPath: "settings.json" } }) },
      getDiff: () => [{ path: ["pi", "settingsPath"] }],
    });

    expect(service.current()).toBe(previous);
    expect(listener).not.toHaveBeenCalled();
  });
});
