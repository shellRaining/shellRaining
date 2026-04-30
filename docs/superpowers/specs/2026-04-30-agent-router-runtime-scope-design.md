# Agent Router Runtime Scope Design

## Goal

Prepare the runtime model for multiple Telegram-visible agents, each backed by its own Pi profile and isolated session scope.

## Background

The current runtime model assumes one Pi runtime identity and stores sessions by Telegram thread key. Multi-agent chat requires routing each message to a selected agent and keeping each agent's session state separate within the same Telegram chat.

## Current Model

Current shape:

```txt
Telegram thread -> PiRuntime -> session keyed by threadKey
```

Future shape:

```txt
Telegram thread -> AgentRouter -> AgentRuntime(agent profile) -> Pi session keyed by agent + thread
```

## Core Components

### AgentRouter

shellRaining-owned component that selects an agent for each Telegram message.

Initial routing rules:

- Explicit command can select an agent.
- Mention or alias can select an agent in group chats.
- If no agent is selected, use `telegram.defaultAgent`.

The exact Telegram command syntax can be finalized in implementation planning. The design requirement is that routing produces an `agentId` before calling Pi runtime.

### Runtime Scope

Pi sessions must be scoped by both agent id and thread key.

Recommended logical shape:

```ts
interface RuntimeScope {
  agentId: string;
  threadKey: string;
}
```

Stable storage key example:

```txt
<agent-id>__<thread-key>
```

The implementation should use a safe encoder instead of direct string concatenation if ids can contain separators.

### Agent Runtime

An agent runtime binds an `AgentDefinition` to its resolved Pi profile root.

It creates Pi SDK objects from the profile root:

- `AuthStorage`
- `ModelRegistry`
- `SettingsManager`
- `DefaultResourceLoader`
- `SessionManager`

## Session Isolation

Session directories should include the agent id so two agents in the same Telegram thread do not share history accidentally.

Example layout:

```txt
<baseDir>/sessions/<agent-id>/<thread-key>/
```

This is shellRaining-owned session storage because it maps Telegram conversation state to Pi sessions. Pi profile config remains separate.

## Workspace Behavior

First version can keep workspace selection per Telegram thread rather than per agent.

That means two agents in the same chat see the same current workspace unless a later spec introduces per-agent workspace state.

This keeps the first multi-agent runtime change smaller.

## Status Command

`/status` should show agent-aware information:

- Current thread id
- Current workspace
- Selected/default agent
- Agent display name
- Pi profile id
- Pi profile root

It should not print Pi secrets or full model credentials.

## Non-Goals

- Do not implement agent-to-agent autonomous conversation in this step.
- Do not add complex group conversation protocol.
- Do not let shellRaining inspect or validate Pi model/skill config.
- Do not implement Pi profile hot reload in this step.

## Acceptance Criteria

- Runtime calls are scoped by agent id and thread key.
- Multiple agents can exist in one Telegram chat without sharing Pi sessions.
- Each agent uses its configured Pi profile root.
- Existing single-agent behavior remains available through the default agent.
- Status output is agent-aware.
