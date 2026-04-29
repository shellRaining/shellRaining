# shellRaining Agent Config Layout Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit unless the user explicitly authorizes it.

Goal: Add a shellRaining-owned config layout while reusing Pi-compatible `settings.json`, `auth.json`, and `models.json` under `~/.shellRaining/agent`.

Architecture: `apps/agent/src/config.ts` remains the public config loader, but it will merge defaults, optional shellRaining `config.json`, and environment overrides. `PiRuntime` will receive Pi-compatible runtime services explicitly: `SettingsManager`, `AuthStorage`, and `ModelRegistry`, all rooted at `config.agentDir`.

Tech Stack: TypeScript, Node.js fs/path/os APIs, Vitest, Pi Coding Agent SDK (`SettingsManager`, `AuthStorage`, `ModelRegistry`, `DefaultResourceLoader`).

---

## File Structure

- Modify `apps/agent/src/config.ts`: load shellRaining config file, resolve `~`, support `env:NAME`, keep current environment variable compatibility, add `settingsPath`, `authPath`, and `modelsPath` derived from `agentDir`.
- Modify `apps/agent/src/pi/runtime.ts`: create and pass Pi SDK `SettingsManager`, `AuthStorage`, and `ModelRegistry` rooted at the shellRaining agent directory.
- Modify `apps/agent/tests/config.test.ts`: add config file merge tests and env override tests.
- Modify `apps/agent/tests/pi-runtime.test.ts`: assert Pi SDK services are created with the shellRaining agent paths and passed to `createAgentSession` / `DefaultResourceLoader`.

## Task 1: Load shellRaining config file

Files:
- Modify: `apps/agent/src/config.ts`
- Test: `apps/agent/tests/config.test.ts`

- [ ] Step 1: Write failing config file test

Add a test that writes a temporary config file and verifies file values are used when no env override is present.

```ts
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
      },
      paths: {
        baseDir: join(tempDir, "base"),
        workspace: join(tempDir, "workspace"),
        agentDir: join(tempDir, "base", "agent"),
        skillsDir: join(tempDir, "skills"),
      },
      agent: { showThinking: true },
      cron: { runTimeoutMs: 1000, misfireGraceMs: 2000 },
      stt: {
        apiKey: "stt-key",
        baseUrl: "https://stt.example.com/",
        model: "whisper-test",
      },
    }),
  );
  process.env.SHELL_RAINING_CONFIG = configPath;

  const { loadConfig } = await import("../src/config.js");
  const config = loadConfig();

  expect(config.telegramToken).toBe("file-token");
  expect(config.telegramApiBaseUrl).toBe("https://telegram.example.com");
  expect(config.telegramWebhookSecret).toBe("file-secret");
  expect(config.allowedUsers).toEqual([123, 456]);
  expect(config.port).toBe(4567);
  expect(config.baseDir).toBe(join(tempDir, "base"));
  expect(config.workspace).toBe(join(tempDir, "workspace"));
  expect(config.agentDir).toBe(join(tempDir, "base", "agent"));
  expect(config.skillsDir).toBe(join(tempDir, "skills"));
  expect(config.showThinking).toBe(true);
  expect(config.cron.jobsPath).toBe(join(tempDir, "base", "cron", "jobs.json"));
  expect(config.cron.runTimeoutMs).toBe(1000);
  expect(config.cron.misfireGraceMs).toBe(2000);
  expect(config.stt).toEqual({
    apiKey: "stt-key",
    baseUrl: "https://stt.example.com",
    model: "whisper-test",
  });
  expect(config.pi.settingsPath).toBe(join(tempDir, "base", "agent", "settings.json"));
  expect(config.pi.authPath).toBe(join(tempDir, "base", "agent", "auth.json"));
  expect(config.pi.modelsPath).toBe(join(tempDir, "base", "agent", "models.json"));
});
```

- [ ] Step 2: Run test to verify it fails

Run: `pnpm --dir "/Users/shellraining/Documents/writable-project/shellRaining" --filter @shellraining/agent test -- tests/config.test.ts`

Expected: FAIL because `loadConfig()` does not read `SHELL_RAINING_CONFIG` and `Config` has no `pi` paths.

- [ ] Step 3: Implement minimal config file loading

In `apps/agent/src/config.ts`, add these imports:

```ts
import { existsSync, readFileSync } from "node:fs";
```

Extend `Config`:

```ts
  pi: {
    settingsPath: string;
    authPath: string;
    modelsPath: string;
  };
```

Add internal config types and helpers:

```ts
interface ShellRainingConfigFile {
  server?: { port?: number };
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
  agent?: { showThinking?: boolean };
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
  if (value.startsWith("env:")) {
    return process.env[value.slice("env:".length)]?.trim() || undefined;
  }
  return value;
}

function loadConfigFile(): ShellRainingConfigFile {
  const path = process.env.SHELL_RAINING_CONFIG?.trim() || join(homedir(), ".shellRaining", "config.json");
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf-8")) as ShellRainingConfigFile;
}

function firstString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const resolved = resolveConfigValue(value)?.trim();
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}
```

Update `loadConfig()` to read file values before env fallbacks, with env overrides taking precedence. Use derived Pi paths:

```ts
const fileConfig = loadConfigFile();
const baseDir = expandHome(
  firstString(process.env.SHELL_RAINING_BASE_DIR, fileConfig.paths?.baseDir) || join(home, ".shellRaining"),
);
const agentDir = expandHome(
  firstString(process.env.SHELL_RAINING_AGENT_DIR, fileConfig.paths?.agentDir) || join(baseDir, "agent"),
);
```

Return:

```ts
pi: {
  settingsPath: join(agentDir, "settings.json"),
  authPath: join(agentDir, "auth.json"),
  modelsPath: join(agentDir, "models.json"),
},
```

- [ ] Step 4: Run config test to verify it passes

Run: `pnpm --dir "/Users/shellraining/Documents/writable-project/shellRaining" --filter @shellraining/agent test -- tests/config.test.ts`

Expected: PASS.

- [ ] Step 5: Check diff, do not commit

Run: `git diff -- apps/agent/src/config.ts apps/agent/tests/config.test.ts`

Expected: only config loader and config tests changed.

## Task 2: Preserve environment variable overrides

Files:
- Modify: `apps/agent/src/config.ts`
- Test: `apps/agent/tests/config.test.ts`

- [ ] Step 1: Write failing env override test

Add a test proving env values override `config.json` values.

```ts
it("lets environment variables override shellRaining config file values", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "shellraining-config-"));
  const configPath = join(tempDir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      server: { port: 4567 },
      telegram: { botToken: "file-token", allowedUsers: [123] },
      paths: { baseDir: join(tempDir, "file-base") },
      agent: { showThinking: false },
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
  expect(config.agentDir).toBe(join(tempDir, "env-base", "agent"));
});
```

- [ ] Step 2: Run test to verify it fails if override logic is incomplete

Run: `pnpm --dir "/Users/shellraining/Documents/writable-project/shellRaining" --filter @shellraining/agent test -- tests/config.test.ts`

Expected: FAIL if any env value does not take precedence.

- [ ] Step 3: Implement env precedence consistently

Update `loadConfig()` so every existing environment variable remains the highest-priority source:

```ts
const token = firstString(process.env.TELEGRAM_BOT_TOKEN, fileConfig.telegram?.botToken);
const port = parseCronNumber(process.env.SHELL_RAINING_PORT, fileConfig.server?.port ?? 3457);
const allowedUsers = process.env.SHELL_RAINING_ALLOWED_USERS?.trim()
  ? process.env.SHELL_RAINING_ALLOWED_USERS.split(",")
      .map((id) => Number.parseInt(id.trim(), 10))
      .filter((id) => !Number.isNaN(id))
  : fileConfig.telegram?.allowedUsers ?? [];
```

Use the same precedence for Telegram API URL, webhook secret, workspace, agentDir, skillsDir, showThinking, cron, STT, and providerBaseUrl compatibility.

- [ ] Step 4: Run config tests

Run: `pnpm --dir "/Users/shellraining/Documents/writable-project/shellRaining" --filter @shellraining/agent test -- tests/config.test.ts`

Expected: PASS.

- [ ] Step 5: Check diff, do not commit

Run: `git diff -- apps/agent/src/config.ts apps/agent/tests/config.test.ts`

Expected: env override behavior is covered by tests.

## Task 3: Wire Pi-compatible settings/auth/models into PiRuntime

Files:
- Modify: `apps/agent/src/pi/runtime.ts`
- Test: `apps/agent/tests/pi-runtime.test.ts`

- [ ] Step 1: Write failing Pi SDK service test

Update the Pi SDK mock in `apps/agent/tests/pi-runtime.test.ts` to include `AuthStorage`, `ModelRegistry`, and `SettingsManager`:

```ts
const authStorageCreate = vi.fn(() => ({ kind: "auth" }));
const modelRegistryCtor = vi.fn(function ModelRegistryMock() {
  return { kind: "models" };
});
const settingsManagerCreate = vi.fn(() => ({ kind: "settings" }));
```

Inside the `vi.mock("@mariozechner/pi-coding-agent", ...)` object add:

```ts
AuthStorage: { create: authStorageCreate },
ModelRegistry: modelRegistryCtor,
SettingsManager: { create: settingsManagerCreate },
```

Extend `createRuntimeConfig()` with:

```ts
pi: {
  settingsPath: "/mock/base/agent/settings.json",
  authPath: "/mock/base/agent/auth.json",
  modelsPath: "/mock/base/agent/models.json",
},
```

Add test:

```ts
it("uses shellRaining-owned Pi-compatible settings, auth, and models files", async () => {
  const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
  const { PiRuntime } = await import("../src/pi/runtime.js");
  const runtime = new PiRuntime(createRuntimeConfig());

  await runtime.prompt("telegram__1", "hello", "/mock/workspace");

  expect(authStorageCreate).toHaveBeenCalledWith("/mock/base/agent/auth.json");
  expect(modelRegistryCtor).toHaveBeenCalledWith(
    { kind: "auth" },
    "/mock/base/agent/models.json",
  );
  expect(settingsManagerCreate).toHaveBeenCalledWith(
    "/mock/workspace",
    "/mock/agent",
  );
  expect(defaultResourceLoader).toHaveBeenCalledWith(
    expect.objectContaining({ settingsManager: { kind: "settings" } }),
  );
  expect(createAgentSession).toHaveBeenCalledWith(
    expect.objectContaining({
      authStorage: { kind: "auth" },
      modelRegistry: { kind: "models" },
      settingsManager: { kind: "settings" },
    }),
  );
});
```

- [ ] Step 2: Run test to verify it fails

Run: `pnpm --dir "/Users/shellraining/Documents/writable-project/shellRaining" --filter @shellraining/agent test -- tests/pi-runtime.test.ts`

Expected: FAIL because `PiRuntime` currently lets `createAgentSession()` create these services implicitly.

- [ ] Step 3: Implement Pi SDK service wiring

In `apps/agent/src/pi/runtime.ts`, import:

```ts
  AuthStorage,
  ModelRegistry,
  SettingsManager,
```

Inside `createSession()` before `DefaultResourceLoader`:

```ts
const authStorage = AuthStorage.create(this.config.pi.authPath);
const modelRegistry = new ModelRegistry(authStorage, this.config.pi.modelsPath);
const settingsManager = SettingsManager.create(cwd, this.config.agentDir);
```

Pass `settingsManager` to `DefaultResourceLoader`:

```ts
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir: this.config.agentDir,
  settingsManager,
  extensionFactories: this.options.extensionFactories?.(threadKey),
  noSkills: true,
  skillsOverride: () => shellRainingSkills,
  appendSystemPromptOverride: ...,
});
```

Pass all three services to `createAgentSession()`:

```ts
const { session } = await createAgentSession({
  cwd,
  agentDir: this.config.agentDir,
  authStorage,
  modelRegistry,
  settingsManager,
  resourceLoader,
  sessionManager: ...,
});
```

- [ ] Step 4: Run PiRuntime tests

Run: `pnpm --dir "/Users/shellraining/Documents/writable-project/shellRaining" --filter @shellraining/agent test -- tests/pi-runtime.test.ts`

Expected: PASS.

- [ ] Step 5: Check diff, do not commit

Run: `git diff -- apps/agent/src/pi/runtime.ts apps/agent/tests/pi-runtime.test.ts`

Expected: Pi SDK services are explicit and rooted in shellRaining paths.

## Task 4: Keep providerBaseUrl as compatibility only

Files:
- Modify: `apps/agent/src/config.ts`
- Modify: `apps/agent/src/pi/runtime.ts`
- Test: `apps/agent/tests/pi-runtime.test.ts`

- [ ] Step 1: Write compatibility test

Keep existing `providerBaseUrl` behavior but ensure it applies to the explicit model registry.

```ts
it("keeps providerBaseUrl as a compatibility provider override", async () => {
  const config = {
    ...createRuntimeConfig(),
    providerBaseUrl: "https://provider.example.com/v1",
  };
  const { PiRuntime } = await import("../src/pi/runtime.js");
  const runtime = new PiRuntime(config);

  await runtime.prompt("telegram__1", "hello", "/mock/workspace");

  expect(modelRegistryCtor.mock.results.at(0)?.value.registerProvider).toHaveBeenCalledWith(
    "shellraining",
    { baseUrl: "https://provider.example.com/v1" },
  );
});
```

Make `modelRegistryCtor` return:

```ts
return { kind: "models", registerProvider: vi.fn() };
```

- [ ] Step 2: Run test to verify it fails if registry mock is not wired

Run: `pnpm --dir "/Users/shellraining/Documents/writable-project/shellRaining" --filter @shellraining/agent test -- tests/pi-runtime.test.ts`

Expected: FAIL until `PiRuntime` calls `registerProvider()` on the explicit `modelRegistry` before session creation or on `session.modelRegistry` after creation.

- [ ] Step 3: Register compatibility provider on explicit model registry

Prefer registering before `createAgentSession()`:

```ts
if (this.config.providerBaseUrl) {
  modelRegistry.registerProvider("shellraining", {
    baseUrl: this.config.providerBaseUrl,
  });
}
```

Remove the post-session `session.modelRegistry.registerProvider(...)` block.

- [ ] Step 4: Run PiRuntime tests

Run: `pnpm --dir "/Users/shellraining/Documents/writable-project/shellRaining" --filter @shellraining/agent test -- tests/pi-runtime.test.ts`

Expected: PASS.

- [ ] Step 5: Check diff, do not commit

Run: `git diff -- apps/agent/src/pi/runtime.ts apps/agent/tests/pi-runtime.test.ts`

Expected: compatibility path remains but is no longer tied to `session.modelRegistry` after session creation.

## Task 5: Full verification

Files:
- Verify all modified files.

- [ ] Step 1: Run agent tests

Run: `pnpm --dir "/Users/shellraining/Documents/writable-project/shellRaining" --filter @shellraining/agent test`

Expected: all tests pass.

- [ ] Step 2: Run typecheck

Run: `pnpm --dir "/Users/shellraining/Documents/writable-project/shellRaining" --filter @shellraining/agent typecheck`

Expected: no TypeScript errors.

- [ ] Step 3: Inspect final diff

Run: `git diff -- apps/agent/src/config.ts apps/agent/src/pi/runtime.ts apps/agent/tests/config.test.ts apps/agent/tests/pi-runtime.test.ts`

Expected: only planned config and Pi runtime changes are present.

- [ ] Step 4: Report result without committing

Summarize changed behavior, tests run, and any compatibility notes. Do not run `git commit` unless the user explicitly asks.

## Self-Review

- Spec coverage: The plan covers shellRaining `config.json`, Pi-compatible `settings.json/auth.json/models.json`, environment override compatibility, and explicit Pi SDK wiring.
- Placeholder scan: No placeholders are intentionally left. Code snippets include concrete names and expected assertions.
- Type consistency: `config.pi.settingsPath`, `config.pi.authPath`, and `config.pi.modelsPath` are introduced in Task 1 and consumed in Task 3. `SettingsManager.create(cwd, agentDir)` is used to preserve Pi-compatible global/project semantics rooted at `agentDir`.
- User constraint: The plan avoids git commits because the repository instructions require explicit user approval before committing.
