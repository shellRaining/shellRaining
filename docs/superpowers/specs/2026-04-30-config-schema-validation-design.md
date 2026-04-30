# Config Schema Validation Design

## Goal

Define and validate the shellRaining application config with TypeBox, and generate a JSON Schema for editor support.

## Background

The project already depends on `@sinclair/typebox`. TypeBox is a good fit because its schemas are JSON Schema fragments and can infer TypeScript types. This avoids adding Zod or Convict while giving runtime validation and editor schema support.

## Schema Scope

The schema covers shellRaining-owned config only:

- `server`
- `telegram`
- `paths`
- `cron`
- `stt`
- `agents`

The schema must not cover Pi-owned files:

- `settings.json`
- `models.json`
- `auth.json`
- project `.pi/settings.json`

## Config File Schema

The input schema should represent optional user-provided values:

```ts
interface ShellRainingConfigFile {
  server?: {
    port?: number;
  };
  telegram?: {
    botToken?: string;
    apiBaseUrl?: string;
    webhookSecret?: string;
    allowedUsers?: number[];
    defaultAgent?: string;
    showThinking?: boolean;
  };
  paths?: {
    baseDir?: string;
    workspace?: string;
  };
  agents?: Record<string, AgentConfigFile>;
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
```

Agent config file shape:

```ts
interface AgentConfigFile {
  displayName?: string;
  piProfile?: string;
  aliases?: string[];
}
```

## Strictness

Unknown shellRaining config keys should fail validation after legacy migration handling. This prevents misspelled config from silently doing nothing.

Legacy keys may be accepted only in the migration layer, not in the main schema.

## Generated JSON Schema

Generate a schema file for editor tooling:

```txt
apps/agent/schema/config.schema.json
```

The generated schema should describe the user config file, not the internal resolved config.

## Validation Errors

Validation errors should include:

- Config file path
- JSON pointer or field path
- Expected type or constraint
- Actual invalid value when safe to show

Sensitive values such as tokens should not be printed in full.

## Environment References

Schema treats `env:NAME` as a string. The loader resolves it after validation. Validation should not require knowing whether the referenced environment variable exists; required secret resolution happens during resolved config construction.

## Non-Goals

- Do not validate Pi settings or models files.
- Do not introduce Zod or Convict.
- Do not implement config loading. This spec assumes C12 loading exists or is planned separately.
- Do not add long-form user documentation unless separately requested.

## Acceptance Criteria

- shellRaining config has a TypeBox schema.
- TypeScript input types derive from the schema.
- Invalid config fails with actionable errors.
- Unknown non-legacy keys fail validation.
- JSON Schema is generated for editor support.
- The schema excludes Pi-owned config fields.
