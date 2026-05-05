# Log Service Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pino-backed log service with stdout JSON plus rolling file output, config integration, and structured observability logs for infrastructure and agent runtime boundaries.

**Architecture:** Add a focused logging module under `apps/agent/src/logging/`, extend the existing config schema and hot-reload classifier with `logging`, then pass child loggers into the app services that currently own lifecycle and agent work. Keep application code behind a project-owned logger interface so Pino remains an implementation detail.

**Tech Stack:** TypeScript ESM, Pino, pino-roll, c12 config, TypeBox schema, Vitest, pnpm.

---

## File Structure

- Create `apps/agent/src/logging/service.ts`: owns Pino setup, child logger creation, redaction, level updates, flush/stop, fallback behavior.
- Create `apps/agent/tests/log-service.test.ts`: tests logger creation, child bindings, level updates, redaction, and fallback behavior.
- Modify `apps/agent/package.json`: add `pino` and `pino-roll` dependencies.
- Modify `apps/agent/src/config/schema.ts`: add resolved and file config logging types/default schema.
- Modify `apps/agent/src/config/loader.ts`: resolve logging defaults, especially default file path under `baseDir`.
- Modify `apps/agent/src/config/changes.ts`: classify `logging.level` as hot, `logging.file.*` as restart-required, apply hot logging level.
- Modify `apps/agent/src/config/index.ts`: export logging types or service-facing config if needed.
- Modify `apps/agent/tests/config.test.ts`, `apps/agent/tests/config-changes.test.ts`, and `apps/agent/tests/config-service.test.ts`: cover logging config and hot reload.
- Modify `apps/agent/src/config/service.ts`: accept optional logger and replace console diagnostics.
- Modify `apps/agent/src/pi/runtime.ts`: accept optional logger and emit session, prompt, steer, and Pi event summary logs.
- Modify `apps/agent/src/pi/profile-watcher.ts`: accept logger and replace console diagnostics plus lifecycle logs.
- Modify `apps/agent/src/pi/skill-watcher.ts`: accept logger and replace console diagnostics plus lifecycle logs.
- Modify `apps/agent/src/bot.ts`: accept optional logger and add Telegram pipeline summary logs without prompt/output content.
- Modify `apps/agent/src/index.ts`: create `LogService`, pass child loggers, wire logging level hot reload, log startup/shutdown/cron boundaries.

## Tasks

### Task 1: Dependencies And Logging Config

**Files:**

- Modify: `apps/agent/package.json`
- Modify: `apps/agent/src/config/schema.ts`
- Modify: `apps/agent/src/config/loader.ts`
- Modify: `apps/agent/src/config/changes.ts`
- Test: `apps/agent/tests/config.test.ts`
- Test: `apps/agent/tests/config-changes.test.ts`

- [ ] **Step 1: Add failing config tests**

Add assertions to `apps/agent/tests/config.test.ts` that verify default logging config resolves to `info` and `<baseDir>/logs/shellraining.log`. Use the existing test helpers in that file and assert against `config.logging`.

Add this test to `apps/agent/tests/config-changes.test.ts`:

```ts
it("classifies logging config paths", () => {
  expect(
    classifyConfigChangePaths([
      ["logging", "level"],
      ["logging", "file", "enabled"],
      ["logging", "file", "path"],
      ["logging", "file", "frequency"],
      ["logging", "file", "limit"],
      ["logging", "file", "mkdir"],
    ]),
  ).toEqual({
    hot: ["logging.level"],
    restartRequired: [
      "logging.file.enabled",
      "logging.file.path",
      "logging.file.frequency",
      "logging.file.limit",
      "logging.file.mkdir",
    ],
    unsupported: [],
  });
});
```

Update `createConfig()` in `apps/agent/tests/config-changes.test.ts` to include:

```ts
logging: {
  level: "info",
  file: {
    enabled: true,
    path: "/base/logs/shellraining.log",
    frequency: "daily",
    limit: "10m",
    mkdir: true,
  },
},
```

Add a `buildEffectiveConfig` assertion that `logging.level` changes while file config remains previous.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/config.test.ts apps/agent/tests/config-changes.test.ts`

Expected: FAIL because `Config` has no `logging` property and classifier does not know logging paths.

- [ ] **Step 3: Add logging config implementation**

In `apps/agent/package.json`, add dependencies:

```json
"pino": "^10.1.0",
"pino-roll": "^3.1.0"
```

In `apps/agent/src/config/schema.ts`, add:

```ts
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type LogFileFrequency = "daily";
```

Add `logging` to `Config`:

```ts
logging: {
  level: LogLevel;
  file: {
    enabled: boolean;
    path: string;
    frequency: LogFileFrequency;
    limit: string;
    mkdir: boolean;
  }
}
```

Add `logging` to `shellRainingConfigFileSchema` with `Type.Union` literals for level and frequency, and defaults in `shellRainingConfigDefaults`:

```ts
logging: {
  file: {
    enabled: true,
    frequency: "daily",
    limit: "10m",
    mkdir: true,
  },
  level: "info",
},
```

In `apps/agent/src/config/loader.ts`, import `join` from `node:path` and resolve logging after `baseDir`:

```ts
const loggingFilePath = expandHome(
  resolveConfigValue(fileConfig.logging?.file?.path) ?? join(baseDir, "logs", "shellraining.log"),
  home,
);
```

Return:

```ts
logging: {
  level: fileConfig.logging?.level ?? "info",
  file: {
    enabled: fileConfig.logging?.file?.enabled ?? true,
    path: loggingFilePath,
    frequency: fileConfig.logging?.file?.frequency ?? "daily",
    limit: fileConfig.logging?.file?.limit ?? "10m",
    mkdir: fileConfig.logging?.file?.mkdir ?? true,
  },
},
```

In `apps/agent/src/config/changes.ts`, add `logging.level` to hot paths, add `logging.file.*` to restart-required paths, clone `logging` in `buildEffectiveConfig`, and apply hot level:

```ts
logging: { ...previous.logging, file: { ...previous.logging.file } },
```

```ts
} else if (key === "logging.level") {
  effective.logging.level = next.logging.level;
}
```

- [ ] **Step 4: Run config tests**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/config.test.ts apps/agent/tests/config-changes.test.ts`

Expected: PASS.

### Task 2: Log Service Module

**Files:**

- Create: `apps/agent/src/logging/service.ts`
- Test: `apps/agent/tests/log-service.test.ts`

- [ ] **Step 1: Write failing log service tests**

Create `apps/agent/tests/log-service.test.ts` with tests for child bindings, redaction, level update, and fallback creation. Mock `pino` so tests do not write real logs.

Use assertions that call `createLogService({ level: "info", file: ... })`, call `service.child({ component: "test" })`, and verify `setLevel("debug")` changes the underlying root logger level.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/log-service.test.ts`

Expected: FAIL because `../src/logging/service.js` does not exist.

- [ ] **Step 3: Implement log service**

Create `apps/agent/src/logging/service.ts` with:

```ts
import pino, { type Logger as PinoLogger } from "pino";
import type { Config, LogLevel } from "../config/index.js";

export type LogBindings = Record<string, unknown>;
export type LogFields = Record<string, unknown>;
export type Logger = Pick<
  PinoLogger,
  "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "child"
>;

export interface LogService {
  logger(): Logger;
  child(bindings: LogBindings): Logger;
  setLevel(level: LogLevel): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export type LoggingConfig = Config["logging"];

const redactPaths = [
  "telegram.botToken",
  "telegram.webhookSecret",
  "stt.apiKey",
  "botToken",
  "webhookSecret",
  "apiKey",
  "token",
  "secret",
];

export function createLogService(config: LoggingConfig): LogService {
  const targets = [{ target: "pino/file", options: { destination: 1 }, level: config.level }];
  if (config.file.enabled) {
    targets.push({
      target: "pino-roll",
      options: {
        file: config.file.path,
        frequency: config.file.frequency,
        limit: config.file.limit,
        mkdir: config.file.mkdir,
      },
      level: config.level,
    });
  }

  let root: PinoLogger;
  try {
    root = pino({
      base: { service: "shellRaining" },
      level: config.level,
      redact: { paths: redactPaths, censor: "[redacted]" },
      transport: { targets },
    });
  } catch (error) {
    root = pino(
      {
        base: { service: "shellRaining", loggingFallback: true },
        level: config.level,
        redact: { paths: redactPaths, censor: "[redacted]" },
      },
      pino.destination(2),
    );
    root.error({ error }, "log service transport setup failed; using stderr fallback");
  }

  return {
    logger: () => root,
    child: (bindings) => root.child(bindings),
    setLevel(level) {
      root.level = level;
    },
    async flush() {
      root.flush?.();
    },
    async stop() {
      root.flush?.();
    },
  };
}

export function createNoopLogger(): Logger {
  const noop = () => undefined;
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return logger as Logger;
}
```

Adjust exact Pino type usage if TypeScript requires a narrower local interface.

- [ ] **Step 4: Run log service tests**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/log-service.test.ts`

Expected: PASS.

### Task 3: ConfigService Logging Integration

**Files:**

- Modify: `apps/agent/src/config/service.ts`
- Test: `apps/agent/tests/config-service.test.ts`

- [ ] **Step 1: Write failing config service logger test**

In `apps/agent/tests/config-service.test.ts`, add a mock logger object:

```ts
const logger = {
  child: vi.fn(() => logger),
  debug: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
};
```

Add a test that constructs `new ConfigService(resolvedConfig, logger)` or `createConfigService(logger)`, triggers invalid watched config, and expects `logger.error` with event `config.reload.invalid`.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/config-service.test.ts`

Expected: FAIL because `ConfigService` does not accept a logger.

- [ ] **Step 3: Implement ConfigService logger**

Modify `apps/agent/src/config/service.ts` to import `createNoopLogger` and `type Logger` from `../logging/service.js`.

Change constructor:

```ts
constructor(initialConfig: Config, logger: Logger = createNoopLogger()) {
  this.effectiveConfig = initialConfig;
  this.logger = logger.child({ component: "config" });
}
```

Add private field:

```ts
private readonly logger: Logger;
```

Replace console diagnostics:

```ts
this.logger.error({ event: "config.reload.invalid", error }, "invalid watched config");
```

```ts
this.logger.warn(
  { event: "config.reload.restart_required", restartRequiredPaths: classification.restartRequired },
  "restart required for config paths",
);
```

```ts
this.logger.warn(
  { event: "config.reload.unsupported", unsupportedPaths: classification.unsupported },
  "unsupported config paths changed",
);
```

Update `createConfigService(logger?: Logger)` to pass logger.

- [ ] **Step 4: Run config service tests**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/config-service.test.ts`

Expected: PASS.

### Task 4: Watcher Logging Integration

**Files:**

- Modify: `apps/agent/src/pi/profile-watcher.ts`
- Modify: `apps/agent/src/pi/skill-watcher.ts`
- Test: `apps/agent/tests/profile-watcher.test.ts`
- Test: `apps/agent/tests/skill-watcher.test.ts`

- [ ] **Step 1: Write failing watcher logger assertions**

In each watcher test file, pass a mock logger in constructor options and assert errors call `logger.error` when the mocked chokidar watcher emits `error`, and reload failures call `logger.error` with component-specific event names.

- [ ] **Step 2: Run watcher tests to verify failure**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/profile-watcher.test.ts apps/agent/tests/skill-watcher.test.ts`

Expected: FAIL because watcher options do not accept logger.

- [ ] **Step 3: Implement watcher logger support**

Add optional `logger?: Logger` to both watcher options. Default to `createNoopLogger().child({ component: "profile-watcher" })` or `skill-watcher`.

Replace existing console calls with structured errors:

```ts
this.logger.error({ event: "watcher.error", error }, "profile watcher error");
this.logger.error(
  { event: "profile.auth_model.reload.error", piProfile: this.options.piProfile, error },
  "profile auth/model reload failed",
);
this.logger.error(
  { event: "profile.resource.reload.error", piProfile: this.options.piProfile, error },
  "profile resource reload failed",
);
```

For `SkillWatcher`, use `skill.reload.error` and `watcher.error`.

- [ ] **Step 4: Run watcher tests**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/profile-watcher.test.ts apps/agent/tests/skill-watcher.test.ts`

Expected: PASS.

### Task 5: PiRuntime Observability

**Files:**

- Modify: `apps/agent/src/pi/runtime.ts`
- Test: `apps/agent/tests/pi-runtime.test.ts`

- [ ] **Step 1: Write failing runtime logging tests**

In `apps/agent/tests/pi-runtime.test.ts`, add a mock logger and instantiate `new PiRuntime(createRuntimeConfig(), { logger })`.

Add tests that verify:

- successful prompt logs `prompt.start` and `prompt.finish`
- assistant error event logs `prompt.assistant_error`
- `tool_execution_start` logs `toolName`
- prompt text is not included in logged fields

- [ ] **Step 2: Run runtime tests to verify failure**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/pi-runtime.test.ts`

Expected: FAIL because `PiRuntimeOptions` has no logger and runtime emits no logs.

- [ ] **Step 3: Implement runtime logging**

Add `logger?: Logger` to `PiRuntimeOptions` and initialize:

```ts
private readonly logger: Logger;

constructor(
  private readonly configSource: ConfigSource,
  private readonly options: PiRuntimeOptions = {},
) {
  this.logger = (options.logger ?? createNoopLogger()).child({ component: "pi-runtime" });
}
```

Add logs around `createSession`, `getOrCreateSession`, `newSession`, `switchSession`, `prompt`, `steer`, `runPrompt`, event subscription, and `dispose`. Use no prompt/output content:

```ts
this.logger.info(
  {
    event: "prompt.start",
    agentId: scope.agentId,
    threadKey: scope.threadKey,
    promptLength: text.length,
    hasImages: Boolean(callbacks.images?.length),
    imageCount: callbacks.images?.length ?? 0,
  },
  "prompt started",
);
```

Measure duration with `const startedAt = Date.now()` and log `durationMs` on finish/error.

For tool event:

```ts
this.logger.info(
  {
    event: "agent.tool.start",
    agentId: scope.agentId,
    threadKey: scope.threadKey,
    toolName: event.toolName,
  },
  "agent tool execution started",
);
```

For tool updates, record only type/length:

```ts
const partialType = typeof event.partialResult;
const partialLength =
  typeof event.partialResult === "string"
    ? event.partialResult.length
    : event.partialResult === undefined
      ? 0
      : JSON.stringify(event.partialResult).length;
this.logger.debug(
  {
    event: "agent.tool.update",
    agentId: scope.agentId,
    threadKey: scope.threadKey,
    partialType,
    partialLength,
  },
  "agent tool execution updated",
);
```

- [ ] **Step 4: Run runtime tests**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/pi-runtime.test.ts`

Expected: PASS.

### Task 6: Bot Pipeline Observability

**Files:**

- Modify: `apps/agent/src/bot.ts`
- Test: existing bot tests under `apps/agent/tests/bot-*.test.ts`

- [ ] **Step 1: Add failing bot logging tests**

In the most focused existing bot test file, pass a mock logger to `createBot(configSource, runtime, logger)` and assert unauthorized access logs `telegram.auth.denied`, command handling logs command name, and prompt branch logs a normalized input summary. Ensure assertions do not expect full message text.

- [ ] **Step 2: Run bot tests to verify failure**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/bot-input.test.ts apps/agent/tests/bot-format.test.ts apps/agent/tests/bot-cron-delivery.test.ts`

Expected: FAIL because `createBot` does not accept a logger.

- [ ] **Step 3: Implement bot logger support**

Change `createBot(configSource, runtime = new PiRuntime(configSource), logger: Logger = createNoopLogger())`.

Create child logger:

```ts
const botLogger = logger.child({ component: "bot" });
```

Pass logger into `handleCommand` and `handlePrompt`. Log:

```ts
botLogger.info(
  { event: "telegram.message.received", threadId: thread.id },
  "telegram message received",
);
botLogger.warn(
  { event: "telegram.auth.denied", threadId: thread.id, userId: message.author.userId },
  "telegram access denied",
);
botLogger.info(
  { event: "telegram.command.handled", command: parsed.command, threadKey },
  "telegram command handled",
);
botLogger.info(
  {
    event: "prompt.input.normalized",
    threadKey,
    textLength: normalized.text.length,
    imageCount: normalized.images?.length ?? 0,
  },
  "telegram input normalized",
);
```

Do not log `message.text`, normalized full text, or reply content.

- [ ] **Step 4: Run bot tests**

Run: `pnpm --filter @shellraining/agent test -- apps/agent/tests/bot-input.test.ts apps/agent/tests/bot-format.test.ts apps/agent/tests/bot-cron-delivery.test.ts`

Expected: PASS.

### Task 7: App Entry And Cron Boundary Logging

**Files:**

- Modify: `apps/agent/src/index.ts`
- Test: `apps/agent/tests/pi-runtime.test.ts` or add focused startup integration test only if an existing one covers `index.ts`

- [ ] **Step 1: Wire log service into app entry**

In `apps/agent/src/index.ts`, import `createLogService`, create it after config load:

```ts
const configService = await createConfigService();
const initialConfig = configService.current();
const logService = createLogService(initialConfig.logging);
const logger = logService.child({ component: "app" });
```

Then pass child loggers:

```ts
runtime = new PiRuntime(currentConfig, { logger: logService.child({ component: "pi-runtime" }), extensionFactories: ... });
const botRuntime = createBot(currentConfig, runtime, logService.child({ component: "bot" }));
```

Update config service construction ordering as needed so `ConfigService` can receive a logger after initial config is available. If the service must log during `start()`, create the service with a bootstrap stderr logger or construct `ConfigService` directly from loaded config. Keep the smallest code change that preserves startup behavior.

- [ ] **Step 2: Add config level hot reload subscription**

Subscribe to config changes:

```ts
configService.subscribe((nextConfig) => {
  logService.setLevel(nextConfig.logging.level);
});
```

- [ ] **Step 3: Add startup, shutdown, and cron logs**

Replace shutdown console call:

```ts
logger.info({ event: "app.shutdown", signal }, "shutting down");
```

In cron callbacks log condition and execution boundaries without prompt text:

```ts
logger.info(
  { event: "cron.execute.start", jobId: job.id, threadKey: job.owner.threadKey },
  "cron job execution started",
);
logger.info(
  {
    event: "cron.execute.finish",
    jobId: job.id,
    status: result.error === undefined ? "success" : "error",
  },
  "cron job execution finished",
);
```

Call `await logService.stop()` during shutdown after runtime disposal.

- [ ] **Step 4: Run typecheck for entry wiring**

Run: `pnpm --filter @shellraining/agent typecheck`

Expected: PASS.

### Task 8: Final Verification And Console Cleanup

**Files:**

- Modify any source file still containing direct console logging.

- [ ] **Step 1: Search for direct console usage**

Run: `rg "console\.(log|warn|error|debug|info)" apps/agent/src packages -n`

Expected: only deliberate fallback path inside `apps/agent/src/logging/service.ts`, or no matches.

- [ ] **Step 2: Run full verification**

Run: `pnpm test`

Expected: PASS.

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 3: Review generated diff**

Run: `git diff -- apps/agent/src apps/agent/tests apps/agent/package.json docs/superpowers/plans/2026-05-05-log-service-observability.md`

Expected: diff implements the spec, contains no prompt/output full-content logging, and keeps logging library usage inside `apps/agent/src/logging/service.ts` except type imports where necessary.

## Self-Review

- Spec coverage: The plan covers Pino, stdout JSON, rolling file output, config integration, hot level reload, restart-required file config, infrastructure logs, agent runtime logs, bot pipeline logs, sensitive data policy, and tests.
- Placeholder scan: The plan avoids TBD/TODO placeholders and gives exact files, commands, and core code shapes.
- Type consistency: The plan consistently uses `LogService`, `Logger`, `LogLevel`, `Config["logging"]`, `createLogService`, and `createNoopLogger`.
