# Pi Profile Hot Reload Design

## Goal

Support hot reload of Pi profile changes without making shellRaining responsible for Pi config schema or field ownership.

## Background

shellRaining will use isolated Pi profiles for Telegram agents. Pi profile contents remain Pi-owned, but shellRaining hosts long-lived Pi runtime sessions. Therefore shellRaining needs to watch Pi profile files and trigger appropriate runtime reload behavior.

Ownership and orchestration are separate:

- PiCodingAgent owns config meaning and parsing.
- shellRaining owns process-level watching and runtime reload orchestration.

## Watched Inputs

For each active Pi profile, watch:

```txt
<profile-root>/settings.json
<profile-root>/models.json
<profile-root>/auth.json
<profile-root>/skills/
<profile-root>/extensions/
<profile-root>/prompts/
<profile-root>/themes/
```

Project-level Pi settings depend on the active workspace:

```txt
<workspace>/.pi/settings.json
```

Project-level watching can be added after profile-level watching if needed, because workspace can change per thread.

## Reload Levels

### Resource Reload

Applies to:

- skills
- extensions
- prompts
- themes
- resource-related `settings.json` changes

Expected action:

```txt
resourceLoader.reload()
session.setActiveToolsByName(session.getActiveToolNames())
```

This mirrors the existing skill reload behavior.

### Registry Reload

Applies to:

- `models.json`
- provider configuration changes
- model list changes

Expected action:

- Rebuild `ModelRegistry` for that profile.
- Decide during implementation whether active sessions can safely keep running or should be recreated for next turn.

Conservative behavior is to recreate sessions for affected profile on the next prompt.

### Auth Reload

Applies to:

- `auth.json`

Expected action:

- Rebuild `AuthStorage` and `ModelRegistry`, or force session recreation for affected profile.
- Do not log token contents.

### Restart Required

Applies to:

- profile root changes
- agent id to profile mapping changes that affect active sessions
- path base changes such as `paths.baseDir`

Expected action:

- Mark affected runtime as requiring restart or explicit recreation.
- Do not attempt transparent in-place migration.

## Watcher Scope

Watchers should be registered per active profile, not globally for all possible profiles. This limits file system load and avoids watching unbounded directories.

When a new agent profile is first used, shellRaining starts watching that profile.

When a profile has no active sessions, watcher cleanup can be a later optimization.

## Debounce

Profile change events should be debounced. The current skill watcher uses 500 ms; the profile watcher can start with the same value.

## Non-Goals

- Do not parse Pi config fields in shellRaining.
- Do not validate Pi config schema.
- Do not implement shellRaining config hot reload here.
- Do not guarantee every Pi setting can update active sessions in-place.

## Acceptance Criteria

- Pi profile resource changes can reload without process restart where supported.
- Changes are scoped to affected profile.
- Pi config contents remain Pi-owned.
- Unsafe changes trigger session recreation or restart-required state instead of partial undefined behavior.
- Secret values from `auth.json` are never logged.
