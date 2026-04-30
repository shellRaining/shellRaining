# Config Ownership Boundary Design

## Goal

Define a strict boundary between shellRaining-owned configuration and PiCodingAgent-owned configuration before replacing the current loader or adding schema validation.

## Background

The current config shape mixes application settings with Pi runtime settings. Examples include `paths.agentDir`, `paths.skillsDir`, and `agent.providerBaseUrl`. These fields make shellRaining responsible for configuration that PiCodingAgent already owns through its native files.

The desired ownership model is:

- shellRaining config contains only shellRaining application behavior.
- PiCodingAgent config contains all Pi runtime behavior.
- shellRaining may choose which Pi profile an application-level agent uses, but it must not own the contents of that profile.

## ShellRaining-Owned Configuration

These fields belong in shellRaining config because they describe the Telegram bot application, persistence layout, or shellRaining services:

- `server.port`
- `telegram.botToken`
- `telegram.apiBaseUrl`
- `telegram.webhookSecret`
- `telegram.allowedUsers`
- `telegram.defaultAgent`
- `telegram.showThinking`
- `paths.baseDir`
- `paths.workspace`
- `cron.jobsPath`
- `cron.runTimeoutMs`
- `cron.misfireGraceMs`
- `stt.apiKey`
- `stt.baseUrl`
- `stt.model`
- `agents`

The `agents` section is shellRaining-owned because it describes identities visible to Telegram and how messages are routed. It must only reference Pi profiles; it must not embed Pi settings.

## PiCodingAgent-Owned Configuration

These fields must not be maintained in shellRaining config:

- `agentDir` as a user-facing Pi config root
- `skillsDir`
- `skills`
- `extensions`
- `prompts`
- `themes`
- `defaultProvider`
- `defaultModel`
- `providerBaseUrl`
- `auth.json` contents
- `models.json` contents
- Pi compaction, retry, thinking, resource, package, and model settings

They belong in Pi profile files:

```txt
<pi-profile-root>/settings.json
<pi-profile-root>/models.json
<pi-profile-root>/auth.json
<workspace>/.pi/settings.json
```

## Pi Profile Concept

A Pi profile is an isolated PiCodingAgent configuration root used by one or more shellRaining agents.

shellRaining owns the mapping:

```txt
agent id -> Pi profile id -> Pi profile root
```

PiCodingAgent owns the profile contents.

The default first-version profile root convention is:

```txt
~/.shellRaining/pi-profiles/<profile-id>/
```

For example:

```txt
~/.shellRaining/pi-profiles/coder/settings.json
~/.shellRaining/pi-profiles/coder/models.json
~/.shellRaining/pi-profiles/coder/auth.json
```

## Non-Goals

- Do not introduce C12 in this step.
- Do not generate JSON Schema in this step.
- Do not implement multi-agent routing in this step.
- Do not parse or validate Pi `settings.json`, `models.json`, or `auth.json`.
- Do not migrate skills or provider config in this step beyond defining their ownership.

## Design Decisions

1. Do not use the default Pi profile for shellRaining runtime by default.

Using the default profile, such as `~/.pi/agent`, would conflict with normal Pi CLI usage. Changes made during daily CLI use could unexpectedly change Telegram bot behavior, and bot-driven writes could affect CLI behavior.

2. Use isolated shellRaining Pi profiles.

Each shellRaining agent maps to a Pi profile under `paths.baseDir` by convention. The default profile root is derived, not directly configured as a Pi internal field.

3. Keep Pi profile contents Pi-native.

shellRaining must not duplicate Pi fields in its own config. If a user wants a profile to use specific skills or models, they edit that profile's Pi files.

## Expected Config Shape

The shellRaining config should move toward this shape:

```json
{
  "server": {
    "port": 3457
  },
  "telegram": {
    "botToken": "env:TELEGRAM_BOT_TOKEN",
    "allowedUsers": [123456],
    "defaultAgent": "coder",
    "showThinking": false
  },
  "paths": {
    "baseDir": "~/.shellRaining",
    "workspace": "~/shellRaining-workspace"
  },
  "agents": {
    "coder": {
      "displayName": "Coder",
      "piProfile": "coder"
    }
  },
  "cron": {
    "runTimeoutMs": 300000,
    "misfireGraceMs": 300000
  }
}
```

## Acceptance Criteria

- shellRaining config no longer treats Pi-owned fields as first-class app configuration.
- Pi profile roots are derived from shellRaining app state, but profile contents remain Pi-owned.
- The config model supports future multi-agent routing without embedding Pi internals.
- Legacy field migration is deferred to a dedicated spec.
