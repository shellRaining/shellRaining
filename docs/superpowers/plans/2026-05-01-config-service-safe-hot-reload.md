# Config Service Safe Hot Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit unless the user explicitly authorizes it.

**Goal:** Add C12-based shellRaining config watching and make the low-risk config fields hot reload for subsequent runtime work.

**Architecture:** Keep `loadConfig()` as the public one-shot loader, but split its internals so watched config uses the same C12 options, TypeBox validation, and resolved-config construction. Add a lightweight `ConfigService` that owns `c12.watchConfig`, maintains an effective config snapshot, classifies changes, and applies only first-phase hot fields. Runtime code reads config through a getter at message/prompt boundaries; unsupported service rebuilds remain restart-required diagnostics.

**Tech Stack:** TypeScript, C12 `loadConfig`/`watchConfig`, TypeBox validation, Vitest, existing Hono/Telegram/Pi runtime code.

---

## File Structure

- Modify: `apps/agent/src/config.ts`
  - Keep public exports.
  - Re-export new config service and change-classification helpers.
  - Keep `loadConfig()` behavior unchanged.
- Create: `apps/agent/src/config/loader.ts`
  - Shared C12 option construction.
  - Raw config loading through `loadConfig`.
  - Validation and resolved `Config` construction.
- Create: `apps/agent/src/config/changes.ts`
  - Classify changed config paths as `hot`, `restart-required`, or `unsupported`.
  - Build the next effective config by copying hot fields only.
- Create: `apps/agent/src/config/service.ts`
  - Own `watchConfig` lifecycle.
  - Maintain loaded/effective config snapshots.
  - Subscribe/unsubscribe runtime listeners.
- Modify: `apps/agent/src/bot.ts`
  - Accept either a config snapshot or a config getter.
  - Read `allowedUsers` and `stt` at message/prompt boundaries.
- Modify: `apps/agent/src/pi/runtime.ts`
  - Accept either a config snapshot or config getter.
  - Capture `telegram.showThinking` at prompt start so subsequent prompts see hot updates without mid-prompt mutation.
- Modify: `apps/agent/src/index.ts`
  - Start `ConfigService` instead of calling `loadConfig()` directly.
  - Pass `() => configService.current()` into bot/runtime.
  - Stop config watcher during shutdown.
- Create: `apps/agent/tests/config-changes.test.ts`
  - Direct unit tests for classification and effective config patching.
- Create: `apps/agent/tests/config-service.test.ts`
  - Mock C12 watch lifecycle and verify effective config behavior.
- Modify: `apps/agent/tests/config.test.ts`
  - Ensure existing one-shot loader behavior still passes.
- Modify: `apps/agent/tests/pi-runtime.test.ts`
  - Add coverage for `showThinking` config getter behavior.

## Task 1: Extract Shared Config Loader

**Files:**

- Create: `apps/agent/src/config/loader.ts`
- Modify: `apps/agent/src/config.ts`
- Test: `apps/agent/tests/config.test.ts`

- [ ] **Step 1: Run current config tests as a baseline**

Run: `pnpm --filter @shellraining/agent test -- tests/config.test.ts`

Expected: PASS before refactor. If it fails, stop and inspect the existing failure before changing code.

- [ ] **Step 2: Create shared loader module**

Create `apps/agent/src/config/loader.ts` with the current logic moved from `config.ts`. Keep function names explicit so later watch code can reuse them.

```ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { loadConfig as loadC12Config } from "c12";
import { resolveAgents, resolveDefaultAgent } from "./agents.js";
import { buildEnvOverrides } from "./env.js";
import { mergeConfigLayers } from "./merge.js";
import { expandHome, trimTrailingSlashes } from "./path.js";
import {
  shellRainingConfigDefaults,
  shellRainingConfigFileSchema,
  type Config,
  type ShellRainingConfigFile,
} from "./schema.js";
import { resolveConfigValue } from "./values.js";

export function getShellRainingConfigPath(): { configured: boolean; path: string } {
  const configuredConfigPath = process.env.SHELL_RAINING_CONFIG?.trim();
  return {
    configured: Boolean(configuredConfigPath),
    path: expandHome(configuredConfigPath || join(homedir(), ".shellRaining", "config.json")),
  };
}

export function createC12ConfigOptions() {
  const configPath = getShellRainingConfigPath();
  if (configPath.configured && !existsSync(configPath.path)) {
    throw new Error(`shellRaining config file not found: ${configPath.path}`);
  }

  return {
    configFile: configPath.path,
    configFileRequired: configPath.configured,
    cwd: dirname(configPath.path),
    defaults: shellRainingConfigDefaults,
    dotenv: {
      fileName: ".env",
    },
    envName: false,
    globalRc: false,
    merger: mergeConfigLayers,
    overrides: () => buildEnvOverrides(),
    packageJson: false,
    rcFile: false,
  };
}

export function validateConfigFile(
  config: ShellRainingConfigFile,
  configPath = getShellRainingConfigPath().path,
): ShellRainingConfigFile {
  const errors = [...Value.Errors(shellRainingConfigFileSchema, config)];
  if (errors.length > 0) {
    const details = errors.map((error) => `${error.path || "/"}: ${error.message}`).join("; ");
    throw new Error(`Invalid shellRaining config file ${configPath}: ${details}`);
  }
  return config;
}

export function resolveConfig(fileConfig: ShellRainingConfigFile): Config {
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
    server: { port },
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

export function resolveLoadedConfig(fileConfig: ShellRainingConfigFile): Config {
  return resolveConfig(validateConfigFile(fileConfig));
}

export async function loadShellRainingConfigFile(): Promise<ShellRainingConfigFile> {
  const { config } = await loadC12Config<ShellRainingConfigFile>(createC12ConfigOptions());
  return validateConfigFile(config);
}
```

- [ ] **Step 3: Update public config module**

Replace the implementation in `apps/agent/src/config.ts` with a thin public surface.

```ts
import { loadShellRainingConfigFile, resolveConfig } from "./config/loader.js";

export type { Config, ResolvedAgentConfig, ShellRainingConfigFile } from "./config/schema.js";
export { shellRainingConfigFileSchema } from "./config/schema.js";

export async function loadConfig() {
  return resolveConfig(await loadShellRainingConfigFile());
}
```

- [ ] **Step 4: Run config tests**

Run: `pnpm --filter @shellraining/agent test -- tests/config.test.ts`

Expected: PASS. This proves the refactor did not change one-shot config behavior.

## Task 2: Add Config Change Classification

**Files:**

- Create: `apps/agent/src/config/changes.ts`
- Create: `apps/agent/tests/config-changes.test.ts`
- Modify: `apps/agent/src/config.ts`

- [ ] **Step 1: Write classifier tests**

Create `apps/agent/tests/config-changes.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { buildEffectiveConfig, classifyConfigChangePaths } from "../src/config.js";

function createConfig(): Config {
  return {
    agents: {
      default: {
        aliases: [],
        displayName: "shellRaining",
        id: "default",
        piProfile: "default",
        profileRoot: "/base/pi-profiles/default",
      },
    },
    cron: {
      jobsPath: "/base/cron/jobs.json",
      misfireGraceMs: 300000,
      runTimeoutMs: 300000,
    },
    paths: {
      baseDir: "/base",
      workspace: "/workspace",
    },
    server: {
      port: 3457,
    },
    stt: {},
    telegram: {
      allowedUsers: [1],
      botToken: "token",
      defaultAgent: "default",
      showThinking: false,
    },
  };
}

describe("config change classification", () => {
  it("classifies first-phase hot fields", () => {
    expect(
      classifyConfigChangePaths([
        ["telegram", "allowedUsers"],
        ["telegram", "showThinking"],
        ["stt", "apiKey"],
        ["stt", "baseUrl"],
        ["stt", "model"],
      ]),
    ).toEqual({
      hot: [
        "telegram.allowedUsers",
        "telegram.showThinking",
        "stt.apiKey",
        "stt.baseUrl",
        "stt.model",
      ],
      restartRequired: [],
      unsupported: [],
    });
  });

  it("classifies service and path changes as restart-required", () => {
    expect(
      classifyConfigChangePaths([
        ["server", "port"],
        ["telegram", "botToken"],
        ["telegram", "apiBaseUrl"],
        ["telegram", "webhookSecret"],
        ["telegram", "defaultAgent"],
        ["paths", "baseDir"],
        ["paths", "workspace"],
        ["agents"],
        ["cron", "jobsPath"],
        ["cron", "runTimeoutMs"],
        ["cron", "misfireGraceMs"],
      ]),
    ).toEqual({
      hot: [],
      restartRequired: [
        "server.port",
        "telegram.botToken",
        "telegram.apiBaseUrl",
        "telegram.webhookSecret",
        "telegram.defaultAgent",
        "paths.baseDir",
        "paths.workspace",
        "agents",
        "cron.jobsPath",
        "cron.runTimeoutMs",
        "cron.misfireGraceMs",
      ],
      unsupported: [],
    });
  });

  it("builds effective config by applying only hot fields", () => {
    const oldConfig = createConfig();
    const newConfig = createConfig();
    newConfig.telegram.allowedUsers = [2, 3];
    newConfig.telegram.showThinking = true;
    newConfig.stt = {
      apiKey: "new-stt-key",
      baseUrl: "https://stt.example.com",
      model: "whisper",
    };
    newConfig.server.port = 9999;

    const effective = buildEffectiveConfig(oldConfig, newConfig, {
      hot: [
        "telegram.allowedUsers",
        "telegram.showThinking",
        "stt.apiKey",
        "stt.baseUrl",
        "stt.model",
      ],
      restartRequired: ["server.port"],
      unsupported: [],
    });

    expect(effective.telegram.allowedUsers).toEqual([2, 3]);
    expect(effective.telegram.showThinking).toBe(true);
    expect(effective.stt).toEqual({
      apiKey: "new-stt-key",
      baseUrl: "https://stt.example.com",
      model: "whisper",
    });
    expect(effective.server.port).toBe(3457);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @shellraining/agent test -- tests/config-changes.test.ts`

Expected: FAIL because `buildEffectiveConfig` and `classifyConfigChangePaths` do not exist.

- [ ] **Step 3: Implement classifier**

Create `apps/agent/src/config/changes.ts`.

```ts
import type { Config } from "./schema.js";

export interface ConfigChangeClassification {
  hot: string[];
  restartRequired: string[];
  unsupported: string[];
}

const HOT_PATHS = new Set([
  "telegram.allowedUsers",
  "telegram.showThinking",
  "stt.apiKey",
  "stt.baseUrl",
  "stt.model",
]);

const RESTART_REQUIRED_PATHS = new Set([
  "server.port",
  "telegram.botToken",
  "telegram.apiBaseUrl",
  "telegram.webhookSecret",
  "telegram.defaultAgent",
  "paths.baseDir",
  "paths.workspace",
  "agents",
  "cron.jobsPath",
  "cron.runTimeoutMs",
  "cron.misfireGraceMs",
]);

function pathKey(path: readonly string[]): string {
  return path.join(".");
}

export function classifyConfigChangePaths(
  paths: Array<readonly string[]>,
): ConfigChangeClassification {
  const result: ConfigChangeClassification = { hot: [], restartRequired: [], unsupported: [] };
  for (const path of paths) {
    const key = pathKey(path);
    if (HOT_PATHS.has(key)) {
      result.hot.push(key);
      continue;
    }
    if (RESTART_REQUIRED_PATHS.has(key) || RESTART_REQUIRED_PATHS.has(path[0] || "")) {
      result.restartRequired.push(key);
      continue;
    }
    result.unsupported.push(key);
  }
  return result;
}

export function buildEffectiveConfig(
  previous: Config,
  next: Config,
  classification: ConfigChangeClassification,
): Config {
  const effective: Config = structuredClone(previous);
  const hot = new Set(classification.hot);

  if (hot.has("telegram.allowedUsers")) {
    effective.telegram.allowedUsers = [...next.telegram.allowedUsers];
  }
  if (hot.has("telegram.showThinking")) {
    effective.telegram.showThinking = next.telegram.showThinking;
  }
  if (hot.has("stt.apiKey") || hot.has("stt.baseUrl") || hot.has("stt.model")) {
    effective.stt = { ...effective.stt };
    if (hot.has("stt.apiKey")) {
      effective.stt.apiKey = next.stt.apiKey;
    }
    if (hot.has("stt.baseUrl")) {
      effective.stt.baseUrl = next.stt.baseUrl;
    }
    if (hot.has("stt.model")) {
      effective.stt.model = next.stt.model;
    }
  }

  return effective;
}
```

- [ ] **Step 4: Re-export classifier from public config module**

Add to `apps/agent/src/config.ts`:

```ts
export { buildEffectiveConfig, classifyConfigChangePaths } from "./config/changes.js";
export type { ConfigChangeClassification } from "./config/changes.js";
```

- [ ] **Step 5: Run classifier tests**

Run: `pnpm --filter @shellraining/agent test -- tests/config-changes.test.ts`

Expected: PASS.

## Task 3: Add ConfigService With C12 Watch Lifecycle

**Files:**

- Create: `apps/agent/src/config/service.ts`
- Create: `apps/agent/tests/config-service.test.ts`
- Modify: `apps/agent/src/config.ts`

- [ ] **Step 1: Write config service tests**

Create `apps/agent/tests/config-service.test.ts`.

```ts
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

describe("ConfigService", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalEnv = process.env;
    process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: "token" };
    for (const key of Object.keys(watchHandlers)) {
      delete watchHandlers[key as keyof WatchHandlers];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function useTempConfig() {
    const tempDir = await mkdtemp(join(tmpdir(), "shellraining-config-service-"));
    const configPath = join(tempDir, "config.json");
    await writeFile(configPath, JSON.stringify({ telegram: { botToken: "token" } }));
    process.env.SHELL_RAINING_CONFIG = configPath;
  }

  it("starts with the same resolved config as the one-shot loader", async () => {
    await useTempConfig();
    loadConfigMock.mockResolvedValue({ config: fileConfig() });
    const { createConfigService, loadConfig } = await import("../src/config.js");

    const service = await createConfigService();
    await service.start();
    const loaded = await loadConfig();

    expect(service.current()).toEqual(loaded);
  });

  it("applies hot changes and keeps restart-required values effective", async () => {
    await useTempConfig();
    loadConfigMock.mockResolvedValue({ config: fileConfig() });
    const { createConfigService } = await import("../src/config.js");
    const service = await createConfigService();
    await service.start();
    const listener = vi.fn();
    service.subscribe(listener);

    await watchHandlers.onUpdate?.({
      oldConfig: { config: fileConfig() },
      newConfig: {
        config: fileConfig({
          server: { port: 9999 },
          telegram: { botToken: "token", allowedUsers: [2], showThinking: true },
        }),
      },
      getDiff: () => [
        { path: ["telegram", "allowedUsers"] },
        { path: ["telegram", "showThinking"] },
        { path: ["server", "port"] },
      ],
    });

    expect(service.current().telegram.allowedUsers).toEqual([2]);
    expect(service.current().telegram.showThinking).toBe(true);
    expect(service.current().server.port).toBe(3457);
    expect(listener).toHaveBeenCalledWith(service.current());
  });

  it("stops the c12 watcher", async () => {
    await useTempConfig();
    loadConfigMock.mockResolvedValue({ config: fileConfig() });
    const { createConfigService } = await import("../src/config.js");
    const service = await createConfigService();
    await service.start();

    await service.stop();

    expect(unwatch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @shellraining/agent test -- tests/config-service.test.ts`

Expected: FAIL because `createConfigService` does not exist.

- [ ] **Step 3: Implement ConfigService**

Create `apps/agent/src/config/service.ts`.

```ts
import { watchConfig } from "c12";
import { buildEffectiveConfig, classifyConfigChangePaths } from "./changes.js";
import {
  createC12ConfigOptions,
  loadShellRainingConfigFile,
  resolveLoadedConfig,
} from "./loader.js";
import type { Config, ShellRainingConfigFile } from "./schema.js";

type ConfigListener = (config: Config) => void | Promise<void>;

interface ConfigWatcherHandle {
  unwatch(): Promise<void>;
}

interface C12DiffEntry {
  key?: string;
  path?: string[];
}

export class ConfigService {
  private effectiveConfig: Config;
  private latestLoadedConfig: Config;
  private listeners = new Set<ConfigListener>();
  private watcher: ConfigWatcherHandle | undefined;

  constructor(initialConfig: Config) {
    this.effectiveConfig = initialConfig;
    this.latestLoadedConfig = initialConfig;
  }

  current(): Config {
    return this.effectiveConfig;
  }

  subscribe(listener: ConfigListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.watcher) {
      return;
    }

    this.watcher = await watchConfig<ShellRainingConfigFile>({
      ...createC12ConfigOptions(),
      onUpdate: async ({ newConfig, getDiff }) => {
        await this.applyWatchedConfig(newConfig.config, getDiff() as C12DiffEntry[]);
      },
    });
  }

  async stop(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = undefined;
    await watcher?.unwatch();
  }

  private async applyWatchedConfig(
    fileConfig: ShellRainingConfigFile,
    diffEntries: C12DiffEntry[],
  ): Promise<void> {
    let nextLoaded: Config;
    try {
      nextLoaded = resolveLoadedConfig(fileConfig);
    } catch (error) {
      console.error(
        "[config] reload rejected",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    const changedPaths = diffEntries.map((entry) => entry.path || (entry.key ? [entry.key] : []));
    const classification = classifyConfigChangePaths(changedPaths);
    if (classification.restartRequired.length > 0) {
      console.error(
        `[config] restart required for changed fields: ${classification.restartRequired.join(", ")}`,
      );
    }
    if (classification.unsupported.length > 0) {
      console.error(
        `[config] unsupported config changes ignored: ${classification.unsupported.join(", ")}`,
      );
    }

    this.latestLoadedConfig = nextLoaded;
    const nextEffective = buildEffectiveConfig(this.effectiveConfig, nextLoaded, classification);
    if (JSON.stringify(nextEffective) === JSON.stringify(this.effectiveConfig)) {
      return;
    }

    this.effectiveConfig = nextEffective;
    await Promise.all([...this.listeners].map((listener) => listener(this.effectiveConfig)));
  }
}

export async function createConfigService(): Promise<ConfigService> {
  const initialConfig = resolveLoadedConfig(await loadShellRainingConfigFile());
  return new ConfigService(initialConfig);
}
```

- [ ] **Step 4: Re-export service from public config module**

Add to `apps/agent/src/config.ts`:

```ts
export { ConfigService, createConfigService } from "./config/service.js";
```

- [ ] **Step 5: Run config service tests**

Run: `pnpm --filter @shellraining/agent test -- tests/config-service.test.ts tests/config-changes.test.ts tests/config.test.ts`

Expected: PASS.

## Task 4: Add Config Getter Support To Runtime Boundaries

**Files:**

- Modify: `apps/agent/src/config.ts`
- Modify: `apps/agent/src/bot.ts`
- Modify: `apps/agent/src/pi/runtime.ts`
- Modify: `apps/agent/tests/pi-runtime.test.ts`

- [ ] **Step 1: Add config source helpers**

Add to `apps/agent/src/config.ts`:

```ts
import type { Config } from "./config/schema.js";

export type ConfigSource = Config | (() => Config);

export function readConfig(source: ConfigSource): Config {
  return typeof source === "function" ? source() : source;
}
```

- [ ] **Step 2: Update bot to read current config at boundaries**

In `apps/agent/src/bot.ts`, change the import and function signatures to use `ConfigSource`.

```ts
import { readConfig, type Config, type ConfigSource } from "./config.js";
```

Update `createBot` to accept `ConfigSource` and read the initial config only for adapter construction:

```ts
export function createBot(configSource: ConfigSource, runtime = new PiRuntime(configSource)): BotRuntime {
  const initialConfig = readConfig(configSource);
  configureWorkspaceState(initialConfig.paths.baseDir);
  const telegram = createTelegramAdapter({
    apiBaseUrl: initialConfig.telegram.apiBaseUrl,
    botToken: initialConfig.telegram.botToken,
    secretToken: initialConfig.telegram.webhookSecret,
    mode: "webhook",
  });
```

Inside each message handler, read config before authorization and command/prompt handling:

```ts
chat.onDirectMessage(async (thread, message) => {
  const config = readConfig(configSource);
  if (!isUserAllowed(config.telegram.allowedUsers, message.author.userId)) {
    await thread.post("未授权访问。");
    return;
  }
  await thread.subscribe();
  if (await handleCommand(thread, message.text || "", config, runtime)) {
    return;
  }
  await handlePrompt(thread, message as TelegramInputMessage, config, runtime);
});
```

Apply the same pattern to `onNewMention` and `onSubscribedMessage`.

- [ ] **Step 3: Update PiRuntime to read current config**

In `apps/agent/src/pi/runtime.ts`, update imports and constructor.

```ts
import { readConfig, type ConfigSource } from "../config.js";
```

Change the constructor field:

```ts
  constructor(
    private readonly configSource: ConfigSource,
    private readonly options: PiRuntimeOptions = {},
  ) {}
```

Add a private getter:

```ts
  private get config() {
    return readConfig(this.configSource);
  }
```

Existing `this.config` reads can stay as-is. Because `createSession()` and session directory resolution read config at session creation, restart-required fields are still not transparently reconciled. The config service prevents those fields from changing in the effective snapshot.

- [ ] **Step 4: Capture showThinking at prompt start**

In `runPrompt()` before subscribing, capture the hot field:

```ts
const showThinking = this.config.telegram.showThinking;
```

Then use the captured value in the event listener:

```ts
if (showThinking && event.assistantMessageEvent.type === "thinking_delta") {
  output += event.assistantMessageEvent.delta;
}
```

- [ ] **Step 5: Add PiRuntime getter test**

In `apps/agent/tests/pi-runtime.test.ts`, add a test near the existing thinking/system prompt tests.

```ts
it("captures showThinking from the config source at prompt start", async () => {
  let currentConfig = createRuntimeConfig();
  sessionSubscribe.mockImplementation((listener: SessionListener) => {
    sessionPrompt.mockImplementation(async () => {
      listener({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "thought" },
      });
    });
    return () => undefined;
  });
  const { PiRuntime } = await import("../src/pi/runtime.js");
  const runtime = new PiRuntime(() => currentConfig);

  let result = await runtime.prompt("telegram__1", "hello", "/mock/workspace");
  expect(result.text).toBe("(no output)");

  await runtime.newSession("telegram__1", "/mock/workspace");
  currentConfig = {
    ...createRuntimeConfig(),
    telegram: { ...createRuntimeConfig().telegram, showThinking: true },
  };

  result = await runtime.prompt("telegram__1", "hello", "/mock/workspace");
  expect(result.text).toBe("thought");
});
```

- [ ] **Step 6: Run runtime tests**

Run: `pnpm --filter @shellraining/agent test -- tests/pi-runtime.test.ts`

Expected: PASS.

## Task 5: Integrate ConfigService In App Startup

**Files:**

- Modify: `apps/agent/src/index.ts`
- Test: existing test suite

- [ ] **Step 1: Replace startup config loading**

In `apps/agent/src/index.ts`, replace the config import:

```ts
import { createConfigService } from "./config.js";
```

Replace startup config loading:

```ts
const configService = await createConfigService();
await configService.start();
const config = configService.current();
const currentConfig = () => configService.current();
```

- [ ] **Step 2: Pass config getter to reload-aware services**

Update PiRuntime and bot creation:

```ts
runtime = new PiRuntime(currentConfig, {
  extensionFactories: (threadKey) => {
    const threadId = getThreadIdFromKey(threadKey);
    const chatId = getChatIdFromThreadKey(threadKey);
    return [buildCronExtensionFactory(cronService, { chatId, threadId, threadKey })];
  },
});
const botRuntime = createBot(currentConfig, runtime);
```

Keep cron store and service using the initial `config` snapshot in this phase:

```ts
const cronStore = new CronStore<AgentCronPayload, AgentCronOwner>(config.cron.jobsPath);
```

This intentionally leaves cron changes restart-required.

- [ ] **Step 3: Stop config watcher during shutdown**

Update `shutdown()`:

```ts
async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`[shellRaining] shutting down on ${signal}`);
  await configService.stop();
  await runtime.dispose();
  process.exit(0);
}
```

Do not add HTTP server or cron shutdown in this phase; that belongs to the later AppRuntime lifecycle phase.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @shellraining/agent test -- tests/config.test.ts tests/config-changes.test.ts tests/config-service.test.ts tests/pi-runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full agent tests**

Run: `pnpm --filter @shellraining/agent test`

Expected: PASS.

## Task 6: Verification And Cleanup

**Files:**

- Inspect: `apps/agent/src/config.ts`
- Inspect: `apps/agent/src/config/*.ts`
- Inspect: `apps/agent/src/index.ts`
- Inspect: `apps/agent/src/bot.ts`
- Inspect: `apps/agent/src/pi/runtime.ts`

- [ ] **Step 1: Typecheck the agent package**

Run: `pnpm --filter @shellraining/agent typecheck`

Expected: PASS.

- [ ] **Step 2: Run full workspace check if focused tests pass**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 3: Inspect diff for scope control**

Run: `git diff -- apps/agent/src/config.ts apps/agent/src/config apps/agent/src/index.ts apps/agent/src/bot.ts apps/agent/src/pi/runtime.ts apps/agent/tests/config-changes.test.ts apps/agent/tests/config-service.test.ts apps/agent/tests/pi-runtime.test.ts docs/superpowers/specs/2026-05-01-config-service-safe-hot-reload-design.md`

Expected: Diff only covers config hot reload infrastructure, runtime getter integration, tests, and the approved spec.

- [ ] **Step 4: Manual behavior notes for final response**

Record the verification commands and outcomes. If a command fails because of an unrelated pre-existing issue, include the exact failure and do not claim the work is complete.

## Self-Review

- Spec coverage: The plan covers C12 watch integration, shared validation/resolution, hot field classification, effective config snapshots, invalid config retention, restart-required diagnostics, shutdown `unwatch`, and no DI framework.
- Known deferred items match the spec: HTTP server rebuild, Telegram adapter rebuild, CronService rebuild, PiRuntime reconcile, and `paths.baseDir` migration are not implemented.
- Type consistency: `ConfigSource`, `readConfig`, `ConfigService`, `createConfigService`, `classifyConfigChangePaths`, and `buildEffectiveConfig` are introduced before use.
