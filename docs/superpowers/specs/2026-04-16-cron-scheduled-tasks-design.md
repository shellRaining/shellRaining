# Cron Scheduled Task Feature Design

## Overview

Add cron/scheduled task functionality to shellRaining. Users can create scheduled tasks through natural language in Telegram (e.g. "明天早上7点提醒我总结新闻"), and the bot will execute the prompt at the scheduled time and return results to the original Telegram thread.

## Core Flow

```
User says "明天早上7点提醒我总结新闻" in Telegram
         |
         v
    Pi Agent parses intent → identifies as cron creation request
    (guided by cron skill at ~/Documents/dotfiles/skills/cron/SKILL.md)
         |
         v
    Pi calls cron_create tool (registered via Pi extension) → generates structured data:
      { schedule: { kind: "at", at: "2026-04-17T07:00:00+08:00" },
        payload: { kind: "agentTurn", message: "总结今天的新闻" } }
         |
         v
    CronService saves to jobs.json → arm timer
         |
         v
    Timer fires → CronService calls PiRuntime.prompt() in isolated session
         |
         v
    Pi executes prompt → result sent back to original Telegram chatId
    (proactive message via Telegram Bot API sendMessage)
```

## Schedule Types

Three types aligned with OpenClaw:

- **at** — one-shot at absolute time (ISO 8601 string). Auto-deleted after successful execution.
- **every** — fixed interval in milliseconds, optional anchor time.
- **cron** — standard cron expression with optional timezone. Uses `croner` library.

## Data Structures

```typescript
type CronSchedule =
  | { kind: "at"; at: string } // ISO 8601 timestamp
  | { kind: "every"; everyMs: number; anchorMs?: number } // anchorMs: epoch ms, base for interval calculation
  | { kind: "cron"; expr: string; tz?: string }; // standard 5-field cron expression

interface CronJob {
  id: string; // nanoid-generated
  name: string; // Pi-generated human-readable description
  chatId: number; // Telegram chat ID to send results back to
  threadKey: string; // Pi session thread key for session reuse
  enabled: boolean;
  deleteAfterRun: boolean; // true for "at" type; only deleted on success
  createdAtMs: number;
  schedule: CronSchedule;
  payload: {
    kind: "agentTurn";
    message: string; // the prompt Pi will execute
  };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: "success" | "error";
    lastError?: string;
    consecutiveErrors: number; // reset to 0 on success
  };
}
```

Storage: `~/.shellRaining/cron/jobs.json`

```json
{
  "version": 1,
  "jobs": [
    /* CronJob[] */
  ]
}
```

## File Structure (new files)

```
src/cron/
├── service.ts        # CronService class: start/stop/add/remove/run, arm timer
├── timer.ts          # setTimeout arming logic
├── schedule.ts       # croner wrapper, compute nextRunAtMs
├── store.ts          # jobs.json read/write
├── types.ts          # type definitions
└── normalize.ts      # defaults + validation

src/cron/__tests__/
├── service.test.ts
├── timer.test.ts
├── schedule.test.ts
└── store.test.ts
```

Plus:

- Pi skill at `~/Documents/dotfiles/skills/cron/SKILL.md` for intent recognition
- Pi extension at `~/.pi/agent/extensions/cron-tools.ts` (or inline in shellRaining) to register cron tools

## CronService Lifecycle

- **start()**: load jobs from store → compute nextRunAtMs for each → arm timer
- **stop()**: clear current timer → flush store
- **add(job)**: write to store → re-arm if this job fires before current armed timer
- **remove(id)**: delete from store → re-arm if removed job was the current target
- **run(id)**: manually trigger a job immediately

## Timer Behavior

Learning from OpenClaw's approach:

```
armTimer():
  1. Find earliest nextRunAtMs among all enabled jobs
  2. delay = nextRunAtMs - Date.now()
  3. delay <= 0 → execute onTimer() immediately
  4. delay > 0 → setTimeout(onTimer, min(delay, 60000))
     (60s cap, periodic re-check to handle clock drift)
  5. No jobs → no timer, wait for add() to re-arm

onTimer():
  1. Find all due jobs
  2. Execute serially (no concurrency)
  3. Update state after each → re-arm timer
```

## Error Handling

- **Consecutive error backoff**: delay increases on repeated failures: 30s → 60s → 5min → 15min → 60min. Applied as `Math.max(normalNextRun, backoffDelay)` so backoff never causes earlier-than-schedule execution.
- **`at` type failure policy**: max 3 retries, then mark as failed and disable. Do not delete — preserve for user inspection.
- **Errors don't delete tasks**: on failure, `deleteAfterRun` jobs are disabled (not deleted) to preserve error state.
- **Execution timeout**: 5 minute cap per run. If execution is still unresolved when the timeout window expires, the run is marked failed; the underlying Pi execution is not forcibly aborted by the current runtime.
- **Startup catch-up for `at` jobs**: only execute if scheduled time is within 5 minutes of now; otherwise mark as missed and disable.
- **consecutiveErrors** resets to 0 on any successful execution.

## Integration Points

### Pi Extension (cron tools registration)

Cron tools (`cron_create`, `cron_list`, `cron_remove`) must be registered via Pi's extension system (`pi.registerTool()`), not via skills. The extension file needs to:

- Accept a `CronService` reference (passed via extension factory or closure)
- Register `cron_create` tool: accepts schedule + payload + chatId, returns job id
- Register `cron_list` tool: returns jobs for the current chat
- Register `cron_remove` tool: removes a job by id

### Pi Skill (~/Documents/dotfiles/skills/cron/SKILL.md)

A cron skill that instructs Pi to:

- Recognize scheduling/reminder intent from natural language
- Extract time information and task content
- Call `cron_create` tool to create jobs
- Call `cron_list` / `cron_remove` tools for management

### Proactive Telegram Messaging

The current bot is purely reactive (webhook → response). Cron needs proactive messaging:

- Use Telegram Bot API `sendMessage` directly (via the chat adapter or raw HTTP)
- Requires storing `chatId` in each CronJob for delivery targeting

### CronService ↔ PiRuntime Wiring

CronService needs PiRuntime to execute prompts on timer fire. PiRuntime sessions need cron tools registered. Resolve via:

- CronService holds a reference to PiRuntime
- Cron tools are registered as part of shellRaining's bot setup, with CronService passed in
- Timer-triggered executions use `PiRuntime.prompt()` with a cron-specific threadKey

### Session Strategy

- Cron jobs store both `chatId` and `threadKey`
- Timer-triggered executions use the stored `threadKey` to reuse the existing Pi session (preserves conversation context)
- If the original session was disposed, create a new isolated session for the cron run
