# Config Service Safe Hot Reload Design

## Goal

Use `c12.watchConfig` to add shellRaining config hot reload infrastructure while limiting the first runtime behavior to low-risk fields.

This phase should make config changes observable, validated, classified, and safely applied where possible. It should not attempt to rebuild the Telegram bot, HTTP server, cron scheduler, or Pi runtime in the same step.

## Background

The current config loader already uses C12 for shellRaining-owned config loading. It supports defaults, environment overrides, TypeBox validation, and JSON Schema generation. The missing piece is runtime watching: `apps/agent/src/index.ts` loads config once at startup and then passes that immutable snapshot to long-lived services.

Current long-lived owners include:

- `createBot(config, runtime)`, which creates the Telegram adapter and message handlers.
- `new PiRuntime(config)`, which caches sessions, profile watchers, and in-flight prompt state.
- `new CronStore(config.cron.jobsPath)` and `new CronService(...)`, which own timers and persistent cron storage.
- `serve({ port: config.server.port })`, which binds the HTTP server port.

These services have different reload boundaries. Treating every config change as a full runtime rebuild would require HTTP shutdown, Telegram adapter replacement, cron timer/store migration, Pi session invalidation, and rollback behavior. That is too broad for the first config hot reload step.

## Non-Goals

- Do not rebuild the HTTP server when `server.port` changes.
- Do not rebuild the Telegram adapter when bot token, API base URL, or webhook secret changes.
- Do not rebuild `CronService` or migrate `CronStore` when cron config changes.
- Do not rebuild or reconcile `PiRuntime` when agents, default agent, profile roots, or path roots change.
- Do not support `paths.baseDir` migration.
- Do not introduce a DI container or service framework.
- Do not replace TypeBox schema validation or the existing C12 loading semantics.
- Do not validate or watch Pi-owned config through this service; Pi profile hot reload remains separate.

## Architecture

Add a lightweight config service layer around the existing loader:

```txt
c12.watchConfig
  -> raw shellRaining config layers
  -> TypeBox validation
  -> resolved Config
  -> diff/classification
  -> safe runtime update or restart-required diagnostic
```

The config service owns C12 watcher lifecycle and publishes effective resolved config snapshots. Runtime code should not call `watchConfig` directly.

An effective snapshot is not always identical to the newest valid file config. When a watched change contains restart-required fields, those fields keep their previous effective values until process restart or a later service-rebuild phase supports them. Hot fields from the same reload may still be applied.

The first implementation should keep the existing `loadConfig()` API for tests and one-shot loading. The watch path should share the same C12 options, schema validation, default handling, environment overrides, and resolved config construction so watched config cannot diverge from startup config.

## ConfigService

Add a small service module under `apps/agent/src/config/`, for example `service.ts`.

Responsibilities:

- Start C12 watching with the same source options used by `loadConfig()`.
- Keep the last valid loaded `Config` snapshot for diagnostics.
- Keep the last effective resolved `Config` snapshot used by runtime code.
- Expose a getter for the current config.
- Notify subscribers when a supported hot reload update is applied.
- Log config reload failures without replacing the last valid config.
- Log restart-required changes with the affected config paths.
- Close the C12 watcher on shutdown by calling `unwatch()`.

The service should not own Telegram, cron, Pi, or HTTP lifecycle. Its output is an effective config snapshot plus a classified change result.

The public shape can be minimal:

```ts
interface ConfigService {
  current(): Config;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (config: Config) => void | Promise<void>): () => void;
}
```

The exact names can change during implementation, but the boundary should remain: config service manages config, not business services.

## Loader Refactor

The current `apps/agent/src/config.ts` mixes three responsibilities:

- C12 loading options.
- TypeBox validation of loaded input config.
- Resolving the internal `Config` object.

For hot reload, split these without changing public behavior:

- Keep `apps/agent/src/config.ts` as the public export surface.
- Move shared C12 option construction into an internal loader helper.
- Move raw input validation plus resolved config construction into reusable helpers.
- Keep `loadConfig()` as a one-shot async loader that uses the same helpers.
- Add a watch entry point that uses `watchConfig` with the same helpers.

This avoids a second implementation path for watched config.

## Change Classification

Add explicit classification for changed config paths. C12 provides `getDiff()` in watcher hooks, but business meaning still belongs to shellRaining.

Initial classes:

```txt
hot
restart-required
unsupported
```

`hot` means the first implementation applies the new value at runtime.

`restart-required` means the new config is valid, but the running service keeps the old effective value. The service logs a clear message telling the user to restart for that field.

`unsupported` is reserved for cases the classifier cannot understand. The safe behavior is to keep the old effective config and log a warning.

When a reload includes both hot and restart-required changes, build the next effective config by copying hot field values from the newest valid config onto the previous effective config. Restart-required fields remain unchanged in the effective snapshot.

First-phase `hot` fields:

```txt
telegram.allowedUsers
telegram.showThinking
stt.apiKey
stt.baseUrl
stt.model
```

First-phase `restart-required` fields:

```txt
server.port
telegram.botToken
telegram.apiBaseUrl
telegram.webhookSecret
telegram.defaultAgent
paths.baseDir
paths.workspace
agents
cron.jobsPath
cron.runTimeoutMs
cron.misfireGraceMs
```

The classifier should be tested directly. Tests should cover every top-level config section and the supported hot fields.

## Runtime Integration

Use the config service in the application entry point instead of a plain immutable `const config = await loadConfig()` snapshot.

The first integration should be intentionally small:

- Create the config service during startup.
- Start watching before or during app startup.
- Use `configService.current()` where runtime handlers need values that can hot reload.
- Pass initial config snapshots to services that are not reloadable yet.
- Stop the config watcher during shutdown.

For hot fields, prefer reading the current config at request or prompt boundaries rather than mutating deeply nested objects in place. This makes it clear when new values take effect.

Expected first-phase behavior:

- `telegram.allowedUsers` affects the next incoming Telegram message authorization check.
- `telegram.showThinking` affects the next Pi prompt. If a prompt is already in flight, it may continue using the value captured at prompt start.
- `stt.*` affects the next voice transcription request.

Do not attempt to make these values change mid-prompt or mid-message.

## Error Handling

Invalid watched config must not poison the running process.

Rules:

- If C12 reload or TypeBox validation fails, keep the previous valid config.
- If resolved config construction fails, keep the previous valid config.
- If only restart-required fields changed, keep serving with the old effective values and log the required restart.
- If hot and restart-required fields changed together, apply only the hot fields if they can be separated safely, and log the restart-required fields.
- Never log token values or secret values.

The log message for restart-required changes should include field paths, not full config objects.

## C12 Watch Notes

Use `watchConfig` rather than a custom `chokidar` watcher.

Important API behavior:

- `watchConfig` performs the initial config load and then watches expected config paths.
- It provides `onWatch`, `acceptHMR`, `onUpdate`, and `unwatch()`.
- It provides `getDiff()` for old vs new config objects.
- It handles debounce; use the default or set an explicit small debounce.

Implementation should wrap C12 details in the config service because the project depends on `c12@4.0.0-beta.4` and beta APIs can change.

## Testing

Add focused tests before implementation.

Config service tests:

- Starts with the same resolved config as `loadConfig()`.
- Applies a valid hot config change.
- Keeps the previous valid config after invalid watched config.
- Calls `unwatch()` on stop.
- Does not notify subscribers for invalid config.

Classifier tests:

- Classifies `telegram.allowedUsers`, `telegram.showThinking`, and `stt.*` as `hot`.
- Classifies HTTP server, Telegram adapter, cron, paths, agents, and default agent changes as `restart-required`.
- Handles mixed hot and restart-required changes.

Runtime integration tests:

- A changed `allowedUsers` value affects the next authorization check.
- A changed `stt` config affects the next voice transcription request.
- A restart-required change produces a diagnostic and does not rebuild unsupported services.

Existing config tests should continue to pass. The one-shot `loadConfig()` API remains supported.

## Future Phases

Phase 2: application lifecycle cleanup.

- Introduce an `AppRuntime` or equivalent to own startup and shutdown.
- Store the HTTP server handle and close it gracefully on shutdown.
- Stop cron service on shutdown.
- Dispose Pi runtime and config watcher in a predictable order.

Phase 3: local service rebuild.

- Add a BotService boundary so Telegram adapter credentials can be rebuilt safely.
- Add a CronService boundary or mutable cron options so cron timeout changes can be applied safely.
- Define running-job behavior before supporting cron store or scheduler replacement.

Phase 4: Pi runtime and path-sensitive config.

- Decide whether agent/defaultAgent changes are restart-only or partially reconcilable.
- Define safe behavior for active sessions and in-flight prompts.
- Keep `paths.baseDir` restart-only unless a migration strategy is explicitly designed.

## Acceptance Criteria

- shellRaining config uses `c12.watchConfig` for runtime watching.
- Watched config reloads reuse the same validation and resolution path as startup config.
- Low-risk hot fields update at runtime for subsequent work.
- Restart-required fields are detected and logged without partial unsupported mutation.
- Invalid watched config leaves the previous valid runtime config in place.
- Watcher lifecycle is closed during shutdown.
- No new DI framework is introduced.
