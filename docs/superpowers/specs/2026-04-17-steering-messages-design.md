# Steering Messages Design

## Overview

Allow users to send follow-up messages while the bot is generating a response. The new message is injected as a "steering" message into the running agent session, causing the bot to adjust its behavior mid-generation. The user sees only the final, adjusted response.

## Background

Currently, `PiRuntime.prompt()` uses an `inflight` map to track running prompts per thread. When a second message arrives for the same thread while one is already running, the second call simply returns the existing promise — the second message text is lost.

The `pi-coding-agent` library natively supports two APIs for this:

- `session.steer(text, images?)` — injects a steering message, delivered after the current assistant turn finishes, before the next LLM call
- `session.followUp(text, images?)` — queues a message to be processed after the agent finishes all work

## Design

### PiRuntime Changes (`src/pi/runtime.ts`)

**New method: `steer()`**

```typescript
async steer(threadKey: string, text: string, images?: PiImageInput[]): Promise<PiPromptResult> {
  const cached = this.sessions.get(threadKey);
  if (!cached) {
    throw new Error(`No active session for thread: ${threadKey}`);
  }
  await cached.session.steer(text, images);
  const running = this.inflight.get(threadKey);
  if (!running) {
    throw new Error(`No inflight prompt for thread: ${threadKey}`);
  }
  return running;
}
```

**Modified `prompt()` method**

Remove the inflight dedup behavior that returns the existing promise. Instead, `prompt()` should only handle the "not currently running" case. The inflight detection and steering dispatch is moved to `handlePrompt` in `bot.ts`.

```typescript
async prompt(threadKey: string, text: string, cwd: string, callbacks: PiPromptCallbacks = {}): Promise<PiPromptResult> {
  const execution = this.runPrompt(threadKey, text, cwd, callbacks);
  this.inflight.set(threadKey, execution);
  try {
    return await execution;
  } finally {
    this.inflight.delete(threadKey);
  }
}
```

**New public accessor: `isRunning(threadKey)`**

Exposes whether a prompt is currently in-flight for a given thread, so `handlePrompt` can make routing decisions.

```typescript
isRunning(threadKey: string): boolean {
  return this.inflight.has(threadKey);
}
```

### handlePrompt Changes (`src/bot.ts`)

**Flow:**

```
handlePrompt(thread, message, config, runtime):
  normalize input
  check rate limit

  if runtime.isRunning(threadKey):
    → runtime.steer(threadKey, normalized.text, normalized.images)
    → await the returned inflight promise
    → send result to Telegram (same as normal flow)
  else:
    → existing flow: get workspace, snapshot, runtime.prompt(), send result
```

Key points:

- When steering, the `workspace` snapshot and `getOrCreateSession` are already handled by the running `runPrompt` — no need to repeat
- Rate limiting still applies to steer calls (prevents spam during generation)
- The steer path does NOT call `thread.startTyping()` — the bot is already generating

### Debounce Interaction

The Chat SDK debounce (1200ms) runs _before_ messages reach `handlePrompt`. This means:

- Two messages within 1200ms → debounce collapses to last one → `handlePrompt` sees one message
- If bot is generating and user sends a message after debounce window → `handlePrompt` sees it, routes to steer

No changes needed to Chat SDK debounce strategy. The debounce naturally handles the "user typing rapidly" case, and once settled, the final message reaches `handlePrompt` which routes it correctly.

### Telegram UX

- User sends message A → bot starts generating
- User sends message B → `handlePrompt` detects inflight, calls `steer()`
- Agent receives steering message between turns, adjusts behavior
- `runPrompt` promise resolves with the full result (including steered output)
- Only the final result is sent to Telegram via `replyLong()`
- User sees the bot "change its mind" naturally — no intermediate messages

## Files Changed

| File                | Change                                                                             |
| ------------------- | ---------------------------------------------------------------------------------- |
| `src/pi/runtime.ts` | Add `steer()`, `isRunning()` methods; simplify `prompt()` to remove inflight dedup |
| `src/bot.ts`        | Add inflight detection branch in `handlePrompt`                                    |

## Edge Cases

- **Session doesn't exist yet but inflight does**: Shouldn't happen — inflight implies session exists. `steer()` throws if session missing.
- **Steer while steer is queued**: `session.steer()` is designed to handle multiple steering messages — they queue in order.
- **Session disposed between inflight check and steer call**: Race condition window is negligible in single-threaded Node.js, but `steer()` will throw if session is gone.
- **Rate limit during steer**: Rate limiter still applies. If user spams while bot generates, they get the cooldown message. This is intentional.
