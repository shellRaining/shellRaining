# Skill Hot-Reload Design

## Overview

Add file-watching based hot-reload for skills, so that changes to SKILL.md files (add, delete, modify) take effect immediately in the current running session without restart. Also remove the redundant shellRaining skill system prompt fragment.

## Background

Skills are loaded once at session creation via `resourceLoader.reload()`. The metadata (name, description, filePath) is cached in `DefaultResourceLoader.skills`. The system prompt's `<available_skills>` catalog is built from this cached list once and reused for all subsequent turns.

However, the actual SKILL.md content is re-read from disk on every `/skill:name` invocation via `readFileSync`. So only the metadata and system prompt catalog need hot-reloading.

The shellRaining `packages/system-prompt/src/fragments/skills.ts` injects skill usage instructions that are already covered by pi-coding-agent's `formatSkillsForPrompt()` and the superpowers `using-superpowers` skill. It provides no unique value and should be removed.

## Architecture

```
chokidar watches skill directories
         |
         v (debounce 500ms)
resourceLoader.reload()  -- refreshes skill metadata cache
         |
         v
session.setActiveToolsByName([...currentTools])  -- triggers _rebuildSystemPrompt()
         |
         v
Next prompt in session sees updated <available_skills> catalog
```

## Skill Watcher

New module: `apps/agent/src/pi/skill-watcher.ts`

Responsibilities:

- Accept a list of skill directory paths to watch
- Use chokidar to watch for `add`, `unlink`, `change` events on `*.md` and `SKILL.md` files
- Debounce file events (500ms) to batch rapid changes
- On debounce flush, call the reload callback

Integration point: `apps/agent/src/pi/runtime.ts` — `PiRuntime` creates a `SkillWatcher` after session creation and closes it on destroy.

### Watched Paths

Three directories (if they exist):

1. User-level: `~/Documents/dotfiles/skills/` (from `SHELL_RAINING_SKILLS_DIR`)
2. Agent-level: `~/.pi/agent/skills/` (from `SHELL_RAINING_AGENT_DIR`)
3. Project-level: `<cwd>/.claude/skills/`

### Reload Mechanism

After `resourceLoader.reload()` refreshes the skill metadata, the system prompt must be rebuilt. The `AgentSession._rebuildSystemPrompt()` method is private, but calling `session.setActiveToolsByName([...currentTools])` with the same tool list triggers a rebuild as a side effect.

The reload flow:

1. `skillWatcher` fires the debounced callback
2. Callback calls `resourceLoader.reload()`
3. Callback reads current active tools via `session.getActiveTools()` (or tracks them separately)
4. Callback calls `session.setActiveToolsByName([...tools])` to trigger `_rebuildSystemPrompt()`
5. Next `prompt()` call uses the updated `_baseSystemPrompt`

### Error Handling

- If `resourceLoader.reload()` throws, log the error and skip the system prompt rebuild
- If a watched directory doesn't exist at startup, skip it (chokidar handles `ignoredInitial` gracefully)
- Watcher errors (permission denied, etc.) are logged but don't crash the process

### Lifecycle

- Created after `PiRuntime` initializes the first session
- Closed when `PiRuntime.destroy()` is called
- One watcher per `PiRuntime` instance, shared across sessions

## Cleanup: Remove Redundant Skill Prompt

Remove the shellRaining skill system prompt fragment that duplicates pi-coding-agent's built-in skill instructions:

1. Delete `packages/system-prompt/src/fragments/skills.ts`
2. Remove `buildSkillsPrompt` import and call from `packages/system-prompt/src/build.ts`
3. Remove `skills` field from the `SystemPromptContext` type (if no other references)
4. Remove `skills` config from `appendSystemPromptOverride` in `apps/agent/src/pi/runtime.ts`

## Files Changed

| File                                                                               | Change                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/agent/src/pi/skill-watcher.ts`                                               | New — chokidar-based watcher with debounce                                   |
| `apps/agent/src/pi/runtime.ts`                                                     | Integrate SkillWatcher, remove skills config from appendSystemPromptOverride |
| `packages/system-prompt/src/fragments/skills.ts`                                   | Delete                                                                       |
| `packages/system-prompt/src/build.ts`                                              | Remove skills fragment import and usage                                      |
| `packages/system-prompt/src/types.ts` (or wherever SystemPromptContext is defined) | Remove `skills` field if no other consumers                                  |

## Out of Scope

- Hot-reload of other resources (agents files, context files)
- Manual `/reload-skills` command
- Skill validation on reload (existing validation in `loadSkills` is sufficient)
