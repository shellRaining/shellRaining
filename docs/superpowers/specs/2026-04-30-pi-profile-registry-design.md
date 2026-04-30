# Pi Profile Registry Design

## Goal

Introduce an application-level registry for Telegram-visible agents and their associated isolated Pi profiles.

## Background

shellRaining currently behaves like a single Telegram chatbot connected to one Pi runtime. Future product direction requires multiple identities in one Telegram chat or group. Each identity may have different skills, models, prompts, and auth. Those differences should be represented by separate Pi profiles, not by duplicating Pi settings in shellRaining config.

## Core Concepts

### Agent

An agent is a shellRaining-owned identity visible to Telegram users. It controls routing and display behavior.

Example fields:

```ts
interface AgentDefinition {
  displayName: string;
  piProfile: string;
  aliases?: string[];
}
```

### Pi Profile

A Pi profile is a PiCodingAgent configuration root. Its contents are Pi-owned.

The first version uses a derived path:

```txt
<baseDir>/pi-profiles/<profile-id>/
```

For default `baseDir = ~/.shellRaining`, profile `coder` resolves to:

```txt
~/.shellRaining/pi-profiles/coder/
```

### Agent Registry

The registry is the shellRaining config section that maps stable agent ids to agent definitions.

Recommended shape:

```json
{
  "agents": {
    "coder": {
      "displayName": "Coder",
      "piProfile": "coder",
      "aliases": ["code"]
    },
    "reviewer": {
      "displayName": "Reviewer",
      "piProfile": "reviewer",
      "aliases": ["review"]
    }
  },
  "telegram": {
    "defaultAgent": "coder"
  }
}
```

Object-map form is preferred over an array because agent ids become stable keys for routing, sessions, and stored state.

## Responsibilities

shellRaining owns:

- Agent ids
- Display names
- Aliases and Telegram routing labels
- Default agent selection
- Mapping from agent id to Pi profile id
- Deriving profile root paths from `paths.baseDir`

PiCodingAgent owns:

- `settings.json`
- `models.json`
- `auth.json`
- Skills, extensions, prompts, themes, packages
- Model/provider selection and credentials

## Default Agent Behavior

When a message does not explicitly select an agent, shellRaining uses `telegram.defaultAgent`.

If `telegram.defaultAgent` is not configured, shellRaining uses the first configured agent after deterministic key sorting.

If no agents are configured, shellRaining creates an internal default definition equivalent to:

```json
{
  "agents": {
    "default": {
      "displayName": "shellRaining",
      "piProfile": "default"
    }
  },
  "telegram": {
    "defaultAgent": "default"
  }
}
```

## Profile Root Derivation

Profile ids are logical names, not arbitrary paths. This avoids reintroducing direct `agentDir` ownership into shellRaining config.

Allowed profile ids should be simple path-safe names:

```txt
[a-zA-Z0-9][a-zA-Z0-9._-]*
```

The resolver must reject profile ids containing path separators or traversal patterns.

Derived root:

```ts
join(baseDir, "pi-profiles", profileId);
```

## Non-Goals

- Do not add explicit profile root paths in the first version.
- Do not support remote profile stores.
- Do not define Pi settings schema.
- Do not define multi-agent conversation protocol beyond identity and routing foundations.

## Future Extension

If advanced users later need to bind agents to existing Pi roots, add a separate `profiles` section:

```json
{
  "profiles": {
    "local-pi": {
      "root": "~/.pi/agent"
    }
  },
  "agents": {
    "coder": {
      "displayName": "Coder",
      "profile": "local-pi"
    }
  }
}
```

This should not be part of the first implementation because it makes ownership and security boundaries harder to reason about.

## Acceptance Criteria

- shellRaining can represent multiple Telegram-visible agents.
- Each agent maps to a Pi profile id.
- Profile roots are derived safely from `baseDir` and profile id.
- No Pi internal settings are embedded in the registry.
- A single default agent path exists for current chatbot behavior.
