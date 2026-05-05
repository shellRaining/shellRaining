# Log Service Observability Design

## Goal

Introduce a shellRaining-owned log service that replaces scattered `console.error` usage with structured logs and improves observability for infrastructure lifecycle and agent execution.

The first phase should use a mature logging library, write logs to both stdout and a local rolling file, integrate logging configuration into the existing config system, and instrument each agent's key runtime nodes without duplicating PICodeAgent's content-level logs.

## Background

The current project has a small number of direct console logs. They are concentrated in:

- `apps/agent/src/config/service.ts`
- `apps/agent/src/index.ts`
- `apps/agent/src/pi/profile-watcher.ts`
- `apps/agent/src/pi/skill-watcher.ts`

The most important observability surfaces are broader than these existing log points:

- App startup, shutdown, config watching, profile watching, skill watching, cron execution, and HTTP serving.
- Telegram message handling, command dispatch, input normalization, prompt execution, steering, artifact detection, and file delivery.
- Pi runtime session creation, cache reuse, profile reload, session invalidation, prompt lifecycle, and PICodeAgent event summaries.

The config service already provides a good service boundary pattern: small module, explicit lifecycle, current snapshot access, and safe hot reload classification. The log service should follow the same style rather than introducing a broad dependency injection framework.

## Library Choice

Use `pino` as the underlying logging library.

Reasons:

- It is mature and widely used in Node.js services.
- It emits structured JSON by default, which is better for future Loki, ELK, OpenTelemetry, or container log collection.
- It supports child loggers and bindings, which fit component, agent, and thread metadata.
- It supports multiple transports, including stdout and file targets.
- It is lighter and more direct for this project than Winston.

Use a Pino-compatible rolling file transport, for example `pino-roll`, for local file rotation. Use Pino's built-in `pino/file` transport for stdout JSON output.

## Non-Goals

- Do not capture, redirect, or monkey-patch PICodeAgent's internal logger in the first phase.
- Do not log full prompt text, assistant output text, tool output, or tool partial results from shellRaining logs.
- Do not add tracing, metrics, or OpenTelemetry exporters in the first phase.
- Do not add a DI container or service framework.
- Do not support runtime rebuilding of log file transports during config hot reload.
- Do not refactor `packages/cron` to depend directly on the agent logging implementation in the first phase.

## Architecture

Add a logging service under `apps/agent/src/logging/`.

```txt
ConfigService
  -> resolved Config.logging
  -> createLogService(config.logging)

LogService
  -> pino root logger
  -> stdout JSON target
  -> rolling file target
  -> child logger factory

Application services
  -> logger.child({ component })
  -> structured lifecycle and runtime logs
```

Application code should depend on the project-owned logger interface rather than directly importing `pino` throughout the codebase. This keeps the logging library replaceable and gives tests a small mockable surface.

The log service should be created during startup before long-lived services are created. It should be passed into `ConfigService`, `PiRuntime`, bot creation, profile watchers, skill watchers, and cron callback boundaries.

## Config

Add a `logging` section to the resolved config:

```ts
logging: {
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  file: {
    enabled: boolean;
    path: string;
    frequency: "daily";
    limit: string;
    mkdir: boolean;
  }
}
```

Default values:

```txt
logging.level = "info"
logging.file.enabled = true
logging.file.path = <baseDir>/logs/shellraining.log
logging.file.frequency = "daily"
logging.file.limit = "10m"
logging.file.mkdir = true
```

Hot reload classification:

- `logging.level` is hot and should update the root logger level at runtime.
- `logging.file.*` is restart-required in the first phase.

This matches the existing config service approach: simple fields can update safely, while service rebuilds stay explicit and restart-only until a later phase designs transport replacement and flush behavior.

## Log Service API

The exact implementation can follow Pino's types internally, but the public project boundary should stay small:

```ts
interface LogService {
  logger(): Logger;
  child(bindings: LogBindings): Logger;
  setLevel(level: LogLevel): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

interface Logger {
  trace(fields: LogFields, message?: string): void;
  debug(fields: LogFields, message?: string): void;
  info(fields: LogFields, message?: string): void;
  warn(fields: LogFields, message?: string): void;
  error(fields: LogFields, message?: string): void;
  fatal(fields: LogFields, message?: string): void;
  child(bindings: LogBindings): Logger;
}
```

The implementation may also allow message-first overloads if that significantly improves ergonomics, but instrumentation should prefer structured fields plus a stable message.

If transport creation fails, the service should fall back to a stderr JSON logger so application startup remains diagnosable.

## Structured Fields

Common fields:

```txt
component
event
durationMs
error
```

Agent and Telegram fields:

```txt
agentId
threadKey
threadId
piProfile
sessionDir
cwd
```

PICodeAgent boundary fields:

```txt
eventType
promptLength
hasImages
imageCount
textLength
artifactOutputLength
```

Config fields:

```txt
hotPaths
restartRequiredPaths
unsupportedPaths
```

The code should prefer stable low-cardinality event names such as `prompt.start`, `prompt.finish`, `session.create.start`, and `config.reload.invalid`.

## Sensitive Data Policy

Never log these values:

- `telegram.botToken`
- `telegram.webhookSecret`
- `stt.apiKey`
- Full prompt text
- Full assistant output
- Full tool output or tool partial result

ShellRaining should not duplicate prompt/output content in its own logs. PICodeAgent may already log some content internally, and the local package source was not available in the workspace during design review, so the safe first-phase behavior is to record only shellRaining boundary metadata and summaries.

If future investigation confirms PICodeAgent does not persist prompt/output content and the project needs full replay logs, that should be designed separately with explicit retention, redaction, and access controls.

## Infrastructure Logging

Application startup and shutdown:

- startup begin and complete
- HTTP proxy dispatcher enabled
- config service start and stop
- cron service start
- HTTP server listen port
- shutdown begin and complete
- shutdown errors

Config service:

- watcher start and stop
- update received
- invalid watched config
- hot fields applied
- restart-required paths detected
- unsupported paths detected
- subscriber notification failure

Profile watcher:

- watcher created and disposed
- profile path change classified
- auth/model invalidation scheduled, complete, and failed
- resource reload scheduled, complete, and failed

Skill watcher:

- watcher created and disposed
- watched path added
- reload scheduled, complete, and failed

Cron boundary:

- service start and stop
- cron condition begin and result
- due job execution begin and result
- prompt execution success, error, and timeout from the app callback boundary

The first phase should log cron from the agent app callback boundary instead of making `packages/cron` depend on agent logging.

## Agent Runtime Logging

Pi runtime session lifecycle:

- `session.create.start`
- `session.create.finish`
- `session.create.error`
- `session.cache.hit`
- `session.cache.stale_disposed`
- `session.cache.cwd_changed`
- `session.new`
- `session.list`
- `session.switch`
- `runtime.dispose`

Profile reload lifecycle:

- `profile.resources.reload.start`
- `profile.resources.reload.finish`
- `profile.sessions.invalidate.start`
- `profile.sessions.invalidate.finish`
- `profile.sessions.invalidate.defer_inflight`

Prompt lifecycle:

- `prompt.accepted`
- `prompt.start`
- `prompt.finish`
- `prompt.error`
- `prompt.assistant_error`

Prompt logs should include `promptLength`, `hasImages`, `imageCount`, `durationMs`, and output lengths only.

Steering lifecycle:

- `steer.accepted`
- `steer.error.no_inflight`
- `steer.error.no_active_session`
- `steer.finish`

PICodeAgent event summaries:

- `agent_start`
- `tool_execution_start` with `toolName`
- `tool_execution_update` with result type and length only
- `message_end` or `turn_end` assistant error summary

## Bot Pipeline Logging

Telegram message handling:

- direct message received
- mention received
- subscribed message received
- authorization allowed or denied
- thread subscribed

Command handling:

- command detected
- command handled
- command rejected or not found

Prompt handling:

- input processability check
- input normalization result with text length and attachment/image counts
- steering branch selected
- prompt branch selected
- workspace snapshot begin and finish
- prompt result success or error
- artifact detection count
- file delivery success or fallback
- Telegram Markdown fallback to raw text

## Error Handling

All existing `console.error` calls should be replaced with structured logger calls.

Logger errors should not crash the application. The log service should attach transport error handlers and write fallback diagnostics to stderr if the primary transport fails.

Shutdown should call `logService.stop()` after other services stop where possible. If the shutdown path itself fails, it should still attempt a best-effort fatal/error log before exiting.

## Testing

Config tests:

- default logging config resolves correctly
- invalid logging level is rejected
- `logging.level` is classified as hot
- `logging.file.*` is classified as restart-required
- hot level update calls `logService.setLevel()` through the integration boundary

Log service tests:

- creates root and child loggers
- child logger preserves bindings
- `setLevel()` updates the active level
- errors serialize with useful message and stack fields
- token, secret, and API key fields are redacted
- fallback logger is used if file transport creation fails

Runtime tests:

- `PiRuntime.prompt()` logs prompt start and finish for success
- `PiRuntime.prompt()` logs prompt error for thrown session errors
- assistant error events produce `prompt.assistant_error`
- tool start events log `toolName`
- full prompt and output text are not sent to logger fields

Bot tests:

- unauthorized access logs a denial event
- command handling logs command name
- prompt branch logs normalized input summary and artifact count
- Telegram Markdown fallback logs fallback without logging full message text

Existing tests should continue to pass.

## Implementation Sequence

1. Add logging dependencies to `apps/agent/package.json`.
2. Extend config schema, defaults, resolver, and change classifier with `logging`.
3. Add `apps/agent/src/logging/service.ts` and public exports.
4. Create `LogService` in `apps/agent/src/index.ts` during startup.
5. Pass child loggers into `ConfigService`, `PiRuntime`, bot creation, profile watchers, skill watchers, and cron callbacks.
6. Replace existing direct `console.error` calls.
7. Add infrastructure lifecycle logs.
8. Add Pi runtime session, prompt, steer, and event-summary logs.
9. Add bot pipeline logs.
10. Add tests and run the existing verification commands.

## Future Phases

Future phases can add:

- Runtime replacement of file transports when `logging.file.*` changes.
- Direct Loki, OpenTelemetry, or remote log transport.
- Trace IDs spanning Telegram message handling, cron execution, and Pi prompt lifecycle.
- Explicit prompt/output archival, if required, with retention and redaction design.
- Direct integration with PICodeAgent's logger if it exposes a stable API.

## Acceptance Criteria

- No direct `console.log`, `console.warn`, or `console.error` remains in app source except inside a deliberate fallback path in the logging service.
- Logs are structured JSON on stdout.
- Logs are also written to a local rolling file by default.
- Logging configuration is part of shellRaining config.
- `logging.level` can hot reload through `ConfigService`.
- File logging settings are restart-required in the first phase.
- Agent runtime key nodes emit structured logs.
- Prompt text, assistant output, and tool output are not duplicated in shellRaining logs.
- Existing tests and type checks pass after implementation.
