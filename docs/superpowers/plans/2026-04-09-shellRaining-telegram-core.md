# shellRaining Telegram Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram-first personal coding agent that reuses Pi CodingAgent SDK, Chat SDK Telegram adapter, and existing mini-claw logic with minimal new code.

**Architecture:** The service keeps Telegram transport thin, moves stateful logic into a small runtime layer, and delegates session persistence plus skills discovery to Pi SDK. Existing mini-claw utility modules are migrated with renamed paths and only thin adaptations for the new state root.

**Tech Stack:** Node.js 22, TypeScript, Hono, chat, @chat-adapter/telegram, @chat-adapter/state-memory, @mariozechner/pi-coding-agent, Vitest

---

### Task 1: Bootstrap Project And Reused Utility Modules

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `src/config.ts`
- Create: `src/runtime/rate-limiter.ts`
- Create: `src/runtime/workspace.ts`
- Create: `src/runtime/artifact-detector.ts`
- Test: `tests/config.test.ts`
- Test: `tests/rate-limiter.test.ts`
- Test: `tests/workspace.test.ts`
- Test: `tests/artifact-detector.test.ts`

- [ ] Write failing tests for config, rate limiter, workspace, and artifact detection.
- [ ] Run `pnpm test tests/config.test.ts tests/rate-limiter.test.ts tests/workspace.test.ts tests/artifact-detector.test.ts` and verify failures are due to missing modules.
- [ ] Implement minimal modules by porting the corresponding mini-claw logic and renaming state roots from `.mini-claw` to `.shellRaining`.
- [ ] Re-run the same test command until all tests pass.

### Task 2: Add Pi Settings Sync And Environment Profile

**Files:**

- Create: `src/runtime/pi-settings.ts`
- Create: `src/runtime/service-profile.ts`
- Create: `tests/pi-settings.test.ts`
- Modify: `src/config.ts`

- [ ] Write failing tests for settings bootstrap, backup creation intent, and skill path merge behavior.
- [ ] Run `pnpm test tests/pi-settings.test.ts` and verify the tests fail first.
- [ ] Implement the minimal Pi settings sync that merges `skills` paths without removing existing entries.
- [ ] Re-run `pnpm test tests/pi-settings.test.ts` until it passes.

### Task 3: Build Pi Runtime Bridge

**Files:**

- Create: `src/pi/runtime.ts`
- Create: `src/pi/session-store.ts`
- Create: `tests/session-store.test.ts`

- [ ] Write failing tests for thread key normalization and session directory mapping.
- [ ] Run `pnpm test tests/session-store.test.ts` and verify the tests fail.
- [ ] Implement the Pi runtime bridge around `createAgentSession()` with per-thread caching and locking.
- [ ] Re-run the session-store tests.

### Task 4: Build Telegram App And Command Routing

**Files:**

- Create: `src/bot.ts`
- Create: `src/index.ts`
- Create: `src/runtime/message-splitter.ts`
- Create: `tests/message-splitter.test.ts`

- [ ] Write failing tests for message splitting.
- [ ] Run `pnpm test tests/message-splitter.test.ts` and verify the tests fail.
- [ ] Implement the Telegram command routing and prompt handling using Chat SDK plus Hono webhook.
- [ ] Re-run `pnpm test tests/message-splitter.test.ts` and all previous tests.

### Task 5: Verify End-To-End Baseline

**Files:**

- Modify: `README.md`
- Create: `.agents/skills/project-architecture/SKILL.md`
- Create: `.agents/skills/project-conventions/SKILL.md`
- Create: `.agents/skills/project-commands/SKILL.md`

- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Update README with exact startup instructions proven by the current code.
- [ ] Record project memory for future agents.
