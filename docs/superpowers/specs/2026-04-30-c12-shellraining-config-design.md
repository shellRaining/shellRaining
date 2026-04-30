# C12 ShellRaining Config Design

## Goal

Use C12 to load shellRaining-owned application configuration while leaving PiCodingAgent profile files under PiCodingAgent ownership.

## Background

The current loader manually reads `~/.shellRaining/config.json`, merges defaults, and applies environment overrides. C12 can reduce loader boilerplate and handle common config loading edge cases. The loader must not start treating Pi profile files as shellRaining config.

## Scope

C12 loads only shellRaining application config:

- `server`
- `telegram`
- `paths`
- `cron`
- `stt`
- `agents`

C12 must not load or merge:

- Pi `settings.json`
- Pi `models.json`
- Pi `auth.json`
- Project `.pi/settings.json`

## Loading Sources

The desired source order is:

1. Built-in defaults
2. C12-loaded config file
3. Environment overrides

Environment overrides should continue to win over file config for deployment compatibility.

## Default Config Location

The default shellRaining config file remains:

```txt
~/.shellRaining/config.json
```

The loader may also accept C12-supported formats later, such as JSONC or TS config, but first implementation should preserve existing JSON behavior unless the implementation plan explicitly expands it.

## Explicit Config Path

`SHELL_RAINING_CONFIG` remains the explicit file selector.

If set, it should point to the shellRaining application config. It must not point to a Pi profile file.

## Async Loading

C12 config loading is async. The app bootstrap should allow async config loading rather than forcing a sync wrapper.

Expected direction:

```ts
const config = await loadConfig();
```

This will affect startup code and tests that currently import and call `loadConfig()` synchronously.

## Environment References

String values may continue to support the existing `env:NAME` convention for secrets inside config files.

Example:

```json
{
  "telegram": {
    "botToken": "env:TELEGRAM_BOT_TOKEN"
  }
}
```

This is separate from environment override behavior. It lets config files reference secrets without storing secret values directly.

## Resolved Config

The loader should output an internal resolved config that includes derived runtime fields, such as resolved profile roots.

Example resolved structure:

```ts
interface ResolvedConfig {
  server: { port: number };
  telegram: {
    botToken: string;
    apiBaseUrl?: string;
    webhookSecret?: string;
    allowedUsers: number[];
    defaultAgent: string;
    showThinking: boolean;
  };
  paths: {
    baseDir: string;
    workspace: string;
  };
  agents: Record<string, ResolvedAgentDefinition>;
  cron: {
    jobsPath: string;
    runTimeoutMs: number;
    misfireGraceMs: number;
  };
  stt: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
}
```

The resolved config may contain profile root paths, but user config should contain profile ids.

## Non-Goals

- Do not add schema generation in this step.
- Do not validate Pi profile files.
- Do not implement config hot reload in this step.
- Do not migrate legacy fields in this step beyond preserving compatibility required by tests.

## Acceptance Criteria

- C12 is responsible for loading shellRaining config files.
- Environment overrides still have highest priority.
- `SHELL_RAINING_CONFIG` can select a shellRaining config file.
- Pi profile files remain outside C12 loading.
- Startup and config tests support async loading.
