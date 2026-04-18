# Cron Condition Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional bash `condition` field to cron jobs so a scheduled run first checks a shell condition and only executes the Pi payload when the condition succeeds.

**Architecture:** Extend the cron job schema, normalization, and `cron_create` tool to accept a structured `condition` object. In `CronService.runJob()`, evaluate the condition via an injected `execCommand` dependency before calling `runtime.prompt()`, treating exit code `0` as run, `1` as silent skip, and `>=2` or execution failures as cron errors. Update the cron skill so the model writes condition scripts with strict exit-code semantics instead of free-form shell.

**Tech Stack:** Node.js 22, TypeScript, Vitest, TypeBox, `node:child_process`, Pi Coding Agent extension tools

---

## File Structure

- Modify `src/cron/types.ts`: add the reusable `CronCondition` type and wire it into `CronJob`.
- Modify `src/cron/normalize.ts`: accept optional `condition`, validate and normalize it, and persist default timeout behavior at the job boundary.
- Modify `tests/cron-normalize.test.ts`: verify `condition` normalization and rejection of invalid condition input.
- Modify `src/cron/tools.ts`: extend `cron_create` parameters and tool description with hard exit-code rules.
- Modify `tests/cron-tools.test.ts`: verify `cron_create` forwards `condition` to `service.add()`.
- Modify `src/cron/service.ts`: add `execCommand`, evaluate conditions, default timeout to 30s, and keep skip/error semantics separate.
- Modify `tests/cron-service.test.ts`: cover no-condition, exit `0`, exit `1`, exit `>=2`, thrown execution failure, timeout/signal failure, and timeout default/override.
- Modify `src/index.ts`: inject a real `execCommand` implementation using `execFile("bash", ["-c", command])`.
- Modify `/Users/shellraining/.config/claude/skills/cron/SKILL.md`: add the `## Condition` section with strict authoring rules for the model.

The work stays inside existing files. No new runtime module is needed because the condition executor is a small dependency adapter owned by `src/index.ts`.

---

### Task 1: Extend Cron Types And Normalization

**Files:**

- Modify: `src/cron/types.ts`
- Modify: `src/cron/normalize.ts`
- Test: `tests/cron-normalize.test.ts`

- [ ] **Step 1: Write the failing normalization tests**

Add these tests to `tests/cron-normalize.test.ts`:

```ts
it("normalizes condition command and timeout", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-16T09:00:00.000Z"));

  const { normalizeCronJobInput } = await import("../src/cron/normalize.js");

  const job = normalizeCronJobInput({
    name: "新闻总结",
    chatId: 1,
    threadId: "telegram:1",
    threadKey: "telegram__1",
    schedule: { kind: "every", everyMs: 60_000 },
    payload: { kind: "agentTurn", message: "总结新闻" },
    condition: {
      command: "  test -f /tmp/done  ",
      timeoutMs: 45_000,
    },
  });

  expect(job.condition).toEqual({
    command: "test -f /tmp/done",
    timeoutMs: 45_000,
  });
});

it("rejects empty condition commands", async () => {
  const { normalizeCronJobInput } = await import("../src/cron/normalize.js");

  expect(() =>
    normalizeCronJobInput({
      name: "bad",
      chatId: 1,
      threadId: "telegram:1",
      threadKey: "telegram__1",
      schedule: { kind: "every", everyMs: 60_000 },
      payload: { kind: "agentTurn", message: "总结新闻" },
      condition: { command: "   " },
    }),
  ).toThrow(/condition/i);
});

it("rejects non-positive condition timeouts", async () => {
  const { normalizeCronJobInput } = await import("../src/cron/normalize.js");

  expect(() =>
    normalizeCronJobInput({
      name: "bad-timeout",
      chatId: 1,
      threadId: "telegram:1",
      threadKey: "telegram__1",
      schedule: { kind: "every", everyMs: 60_000 },
      payload: { kind: "agentTurn", message: "总结新闻" },
      condition: { command: "test -f /tmp/done", timeoutMs: 0 },
    }),
  ).toThrow(/timeout/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test tests/cron-normalize.test.ts
```

Expected: FAIL because `CronJobInput` does not accept `condition`, `CronJob` has no `condition` field, and timeout validation does not exist.

- [ ] **Step 3: Add the minimal type and normalization changes**

In `src/cron/types.ts`, add this type above `CronJob`:

```ts
export interface CronCondition {
  command: string;
  timeoutMs?: number;
}
```

Then add this field inside `CronJob` before `payload`:

```ts
  condition?: CronCondition;
```

In `src/cron/normalize.ts`, update imports and `CronJobInput`:

```ts
import type { CronCondition, CronJob, CronSchedule } from "./types.js";
```

```ts
  condition?: CronCondition;
```

Inside `normalizeCronJobInput()`, add condition normalization before the returned object:

```ts
const conditionCommand = input.condition?.command?.trim();
const conditionTimeoutMs = input.condition?.timeoutMs;

if (input.condition && !conditionCommand) {
  throw new Error("Cron job condition command is required");
}

if (conditionTimeoutMs !== undefined) {
  if (!Number.isInteger(conditionTimeoutMs) || conditionTimeoutMs <= 0) {
    throw new Error("Cron job condition timeout must be a positive integer");
  }
}
```

Add this property to the returned job object right before `payload`:

```ts
    condition: conditionCommand
      ? {
          command: conditionCommand,
          timeoutMs: conditionTimeoutMs,
        }
      : undefined,
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test tests/cron-normalize.test.ts
```

Expected: PASS for the existing tests plus the three new condition tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/cron/types.ts src/cron/normalize.ts tests/cron-normalize.test.ts
git commit -m "feat: add cron condition schema"
```

---

### Task 2: Extend cron_create Parameters And Guardrails

**Files:**

- Modify: `src/cron/tools.ts`
- Test: `tests/cron-tools.test.ts`

- [ ] **Step 1: Write the failing tool test**

Add this test to `tests/cron-tools.test.ts`:

```ts
it("forwards condition fields through cron_create", async () => {
  const { buildCronExtensionFactory } = await import("../src/cron/tools.js");
  const service = {
    add: vi.fn(async (job: CronJob) => job),
    listJobs: vi.fn(async () => []),
    remove: vi.fn(async () => false),
  };
  const registerTool = vi.fn();

  await buildCronExtensionFactory(service as any, thread)(createExtensionApi(registerTool));

  const tool = getRegisteredTool(registerTool, "cron_create");
  await tool.execute("tool_1", {
    name: "等待文件完成",
    schedule: { kind: "every", everyMs: 60_000 },
    condition: {
      command: "test -f /tmp/done",
      timeoutMs: 45_000,
    },
    payload: { kind: "agentTurn", message: "请通知我文件已完成。" },
  });

  expect(service.add).toHaveBeenCalledWith(
    expect.objectContaining({
      condition: {
        command: "test -f /tmp/done",
        timeoutMs: 45_000,
      },
    }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test tests/cron-tools.test.ts
```

Expected: FAIL because the `cron_create` parameter schema rejects `condition` and the execute path does not pass it through.

- [ ] **Step 3: Extend the tool parameter schema and description**

In `src/cron/tools.ts`, add the `condition` property to the `cron_create` parameters object:

```ts
        condition: Type.Optional(
          Type.Object({
            command: Type.String({ minLength: 1 }),
            timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
          }),
        ),
```

Replace the current `description` string for `cron_create` with:

```ts
      description:
        "Create a scheduled cron job for the current chat thread. Condition rules: exit 0 runs the job, exit 1 silently skips this occurrence, exit 2+ counts as a script error. Keep condition scripts short, avoid set -e, and only set timeoutMs when the check genuinely takes time.",
```

Do not change the execute body beyond continuing to pass the full `params` object into `normalizeCronJobInput()`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test tests/cron-tools.test.ts
```

Expected: PASS for the existing tests plus the new condition-forwarding test.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/cron/tools.ts tests/cron-tools.test.ts
git commit -m "feat: accept cron conditions in tool inputs"
```

---

### Task 3: Execute Conditions In CronService

**Files:**

- Modify: `src/cron/service.ts`
- Test: `tests/cron-service.test.ts`

- [ ] **Step 1: Write the failing service tests**

In `tests/cron-service.test.ts`, add these type aliases near the existing mock aliases:

```ts
type ExecCommand = CronServiceDeps["execCommand"];
type ExecCommandMock = Mock<ExecCommand>;
```

Add `let execCommand: ExecCommandMock;` next to the other mock declarations and initialize it in `beforeEach()`:

```ts
execCommand = vi.fn<ExecCommand>(async () => ({ exitCode: 0 }));
```

Add `execCommand` to every `new CronService({...})` dependency object in this file.

Then append these tests inside `describe("CronService", ...)`:

```ts
it("runs the payload when condition exits 0", async () => {
  const { CronService } = await import("../src/cron/service.js");
  execCommand.mockResolvedValue({ exitCode: 0 });
  const job = createJob({
    id: "condition-pass",
    condition: { command: "test -f /tmp/done", timeoutMs: 45_000 },
    state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
  });
  const store = createStore([job]);
  const service = new CronService({
    store,
    runtime: { prompt: runtimePrompt },
    execCommand,
    deliver,
    workspaceForThreadKey,
    now: () => nowMs,
    setTimeoutFn,
    clearTimeoutFn,
    runTimeoutMs: 5_000,
    misfireGraceMs: 5 * 60_000,
  });

  await service.run(job.id);

  expect(execCommand).toHaveBeenCalledWith("test -f /tmp/done", "/mock/workspace", 45_000);
  expect(runtimePrompt).toHaveBeenCalledTimes(1);
  expect(deliver).toHaveBeenCalledWith("telegram:42", "done");
});

it("silently skips when condition exits 1", async () => {
  const { CronService } = await import("../src/cron/service.js");
  execCommand.mockResolvedValue({ exitCode: 1 });
  const job = createJob({
    id: "condition-skip",
    condition: { command: "test -f /tmp/done" },
    state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
  });
  const store = createStore([job]);
  const service = new CronService({
    store,
    runtime: { prompt: runtimePrompt },
    execCommand,
    deliver,
    workspaceForThreadKey,
    now: () => nowMs,
    setTimeoutFn,
    clearTimeoutFn,
    runTimeoutMs: 5_000,
    misfireGraceMs: 5 * 60_000,
  });

  await service.run(job.id);

  expect(runtimePrompt).not.toHaveBeenCalled();
  expect(deliver).not.toHaveBeenCalled();
  expect(store.snapshot()).toEqual([
    expect.objectContaining({
      id: "condition-skip",
      state: expect.objectContaining({
        consecutiveErrors: 0,
        nextRunAtMs: Date.parse("2026-04-16T09:01:00.000Z"),
        lastRunAtMs: undefined,
        lastRunStatus: undefined,
      }),
    }),
  ]);
});

it("treats condition exit codes above 1 as failures", async () => {
  const { CronService } = await import("../src/cron/service.js");
  execCommand.mockResolvedValue({ exitCode: 2 });
  const job = createJob({
    id: "condition-error",
    condition: { command: "bad-command" },
    state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
  });
  const store = createStore([job]);
  const service = new CronService({
    store,
    runtime: { prompt: runtimePrompt },
    execCommand,
    deliver,
    workspaceForThreadKey,
    now: () => nowMs,
    setTimeoutFn,
    clearTimeoutFn,
    runTimeoutMs: 5_000,
    misfireGraceMs: 5 * 60_000,
  });

  await service.run(job.id);

  expect(runtimePrompt).not.toHaveBeenCalled();
  expect(store.snapshot()).toEqual([
    expect.objectContaining({
      id: "condition-error",
      state: expect.objectContaining({
        lastRunStatus: "error",
        lastError: "Condition command exited with code 2",
        consecutiveErrors: 1,
      }),
    }),
  ]);
});

it("treats condition execution exceptions as failures", async () => {
  const { CronService } = await import("../src/cron/service.js");
  execCommand.mockRejectedValue(new Error("spawn ENOENT"));
  const job = createJob({
    id: "condition-throw",
    condition: { command: "missing-command" },
    state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
  });
  const store = createStore([job]);
  const service = new CronService({
    store,
    runtime: { prompt: runtimePrompt },
    execCommand,
    deliver,
    workspaceForThreadKey,
    now: () => nowMs,
    setTimeoutFn,
    clearTimeoutFn,
    runTimeoutMs: 5_000,
    misfireGraceMs: 5 * 60_000,
  });

  await service.run(job.id);

  expect(store.snapshot()).toEqual([
    expect.objectContaining({
      id: "condition-throw",
      state: expect.objectContaining({
        lastRunStatus: "error",
        lastError: "spawn ENOENT",
        consecutiveErrors: 1,
      }),
    }),
  ]);
});

it("uses the default 30000ms timeout when condition.timeoutMs is omitted", async () => {
  const { CronService } = await import("../src/cron/service.js");
  const job = createJob({
    id: "condition-default-timeout",
    condition: { command: "test -f /tmp/done" },
    state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
  });
  const store = createStore([job]);
  const service = new CronService({
    store,
    runtime: { prompt: runtimePrompt },
    execCommand,
    deliver,
    workspaceForThreadKey,
    now: () => nowMs,
    setTimeoutFn,
    clearTimeoutFn,
    runTimeoutMs: 5_000,
    misfireGraceMs: 5 * 60_000,
  });

  await service.run(job.id);

  expect(execCommand).toHaveBeenCalledWith("test -f /tmp/done", "/mock/workspace", 30_000);
});

it("treats signal-killed condition processes as failures", async () => {
  const { CronService } = await import("../src/cron/service.js");
  execCommand.mockResolvedValue({ exitCode: null, signal: "SIGTERM" });
  const job = createJob({
    id: "condition-signal",
    condition: { command: "sleep 60", timeoutMs: 50_000 },
    state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
  });
  const store = createStore([job]);
  const service = new CronService({
    store,
    runtime: { prompt: runtimePrompt },
    execCommand,
    deliver,
    workspaceForThreadKey,
    now: () => nowMs,
    setTimeoutFn,
    clearTimeoutFn,
    runTimeoutMs: 5_000,
    misfireGraceMs: 5 * 60_000,
  });

  await service.run(job.id);

  expect(store.snapshot()).toEqual([
    expect.objectContaining({
      id: "condition-signal",
      state: expect.objectContaining({
        lastRunStatus: "error",
        lastError: "Condition command terminated by signal SIGTERM",
        consecutiveErrors: 1,
      }),
    }),
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test tests/cron-service.test.ts
```

Expected: FAIL because `CronServiceDeps` does not define `execCommand`, the service never evaluates conditions, and the skip/error semantics do not exist.

- [ ] **Step 3: Implement condition execution in the service**

In `src/cron/service.ts`, add this dependency field inside `CronServiceDeps` after `runtime`:

```ts
execCommand: (command: string, cwd: string, timeoutMs: number) =>
  Promise<{
    exitCode: number | null;
    signal?: NodeJS.Signals;
  }>;
```

Add this constant near the imports:

```ts
const DEFAULT_CONDITION_TIMEOUT_MS = 30_000;
```

Inside `runJob()`, after resolving `workspace` and before `runWithTimeout(() => this.deps.runtime.prompt(...))`, insert:

```ts
if (job.condition) {
  const conditionResult = await this.deps.execCommand(
    job.condition.command,
    workspace,
    job.condition.timeoutMs ?? DEFAULT_CONDITION_TIMEOUT_MS,
  );

  if (conditionResult.exitCode === 1) {
    const skipped: CronJob = {
      ...job,
      state: {
        ...job.state,
        nextRunAtMs: computeNextRunAtMs(job.schedule, nowMs + 1),
      },
    };
    await this.saveUpdatedJob(data, skipped);
    if (rescheduleAfterRun) {
      await this.scheduleNextTimer();
    }
    return skipped;
  }

  if (conditionResult.exitCode !== 0) {
    const message = conditionResult.signal
      ? `Condition command terminated by signal ${conditionResult.signal}`
      : `Condition command exited with code ${conditionResult.exitCode}`;
    const updated = this.buildFailureJob(job, nowMs, message);
    await this.saveUpdatedJob(data, updated);
    if (rescheduleAfterRun) {
      await this.scheduleNextTimer();
    }
    return updated;
  }
}
```

Do not change the existing payload success path. The only new behavior should be preflight condition execution plus the silent-skip branch.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test tests/cron-service.test.ts
```

Expected: PASS for the existing service tests plus the six new condition tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/cron/service.ts tests/cron-service.test.ts
git commit -m "feat: run cron conditions before payloads"
```

---

### Task 4: Inject The Real bash Executor

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing integration expectation as a build check**

There is no existing test file for `src/index.ts`, so use type/build failure as the first red bar.

Run:

```bash
pnpm build
```

Expected: FAIL after Task 3 because `new CronService({...})` in `src/index.ts` no longer satisfies `CronServiceDeps` without `execCommand`.

- [ ] **Step 2: Add the minimal `execCommand` adapter**

In `src/index.ts`, add this import near the top:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
```

Add this helper near the runtime setup, before `const cronService = new CronService({...})`:

```ts
const execFileAsync = promisify(execFile);

async function execCommand(command: string, cwd: string, timeoutMs: number) {
  try {
    await execFileAsync("bash", ["-c", command], {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return { exitCode: 0 as const };
  } catch (error) {
    const details = error as NodeJS.ErrnoException & {
      code?: string | number;
      signal?: NodeJS.Signals;
      killed?: boolean;
    };

    if (typeof details.code === "number") {
      return { exitCode: details.code, signal: details.signal };
    }

    if (details.signal) {
      return { exitCode: null, signal: details.signal };
    }

    throw error;
  }
}
```

Then add this property to the `CronService` dependency object:

```ts
  execCommand,
```

- [ ] **Step 3: Run build and targeted tests**

Run:

```bash
pnpm build && pnpm test tests/cron-normalize.test.ts tests/cron-tools.test.ts tests/cron-service.test.ts
```

Expected: PASS. Build succeeds and the three targeted cron test files pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/index.ts
git commit -m "feat: inject cron condition command runner"
```

---

### Task 5: Teach The Cron Skill To Write Conditions Safely

**Files:**

- Modify: `/Users/shellraining/.config/claude/skills/cron/SKILL.md`

- [ ] **Step 1: Update the skill with a strict `## Condition` section**

Insert this section between `## Build The Schedule` and `## Rewrite The Future Payload`:

````md
## Condition

Use `condition` only when the user means “run this scheduled task only if some check succeeds”. If the user only wants a normal reminder or recurring task, do not add `condition`.

Common condition signals:

- “等 XX 完成后提醒我”
- “如果 XX 就通知我”
- “每隔 N 分钟检查，XX 就绪后通知”

When you include `condition`, create:

```json
{
  "condition": {
    "command": "test -f /tmp/done",
    "timeoutMs": 30000
  }
}
```
````

Exit-code rules you MUST follow:

- `exit 0`: condition met, the cron payload will run
- `exit 1`: condition not met, the occurrence is silently skipped
- `exit 2+`: script error; only use this for unrecoverable problems such as bad paths or invalid command assumptions

Allowed condition-writing patterns:

1. Direct command status check: `pgrep -f "my-server"`
2. Output comparison with `test`: `test "$( curl -sf https://example.com/health )" = "ok"`
3. Short chained check: `test -f /tmp/done && test "$( cat /tmp/done )" = "ready"`

Hard rules:

- Keep the command to one line
- Do not use `set -e`
- Do not rely on stdout being shown to the user
- Do not invent your own exit-code convention
- Only set `timeoutMs` when the check can legitimately take longer than the default 30000ms
- Never exceed `300000` for `timeoutMs`

````

- [ ] **Step 2: Read the updated section and spot-check clarity**

Run:

```bash
python - <<'PY'
from pathlib import Path
text = Path('/Users/shellraining/.config/claude/skills/cron/SKILL.md').read_text()
start = text.index('## Condition')
end = text.index('## Rewrite The Future Payload')
print(text[start:end])
PY
````

Expected: the new section appears exactly once, with the three allowed patterns and the hard rules intact.

- [ ] **Step 3: Commit**

Run:

```bash
git add /Users/shellraining/.config/claude/skills/cron/SKILL.md
git commit -m "docs: add cron condition authoring rules"
```

---

### Task 6: Final Verification

**Files:**

- Modify: none
- Test: `tests/cron-normalize.test.ts`
- Test: `tests/cron-tools.test.ts`
- Test: `tests/cron-service.test.ts`

- [ ] **Step 1: Run the focused verification suite**

Run:

```bash
pnpm test tests/cron-normalize.test.ts tests/cron-tools.test.ts tests/cron-service.test.ts
```

Expected: PASS for all three files.

- [ ] **Step 2: Run the repo build check**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Run the project quality gate used by this repo**

Run:

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git commit -m "chore: verify cron condition implementation"
```

Only do this step if the verification task changed tracked files (for example formatting). If verification is clean and produces no file changes, skip the commit.

---

## Self-Review

- Spec coverage: data model, normalization, service execution semantics, tool description, skill guidance, timeout behavior, and targeted tests are all mapped to Tasks 1-6.
- Placeholder scan: no `TBD`, no implicit “write tests later”, and every code-edit step contains concrete snippets or exact commands.
- Type consistency: the plan uses `condition.command`, `condition.timeoutMs`, and `execCommand(command, cwd, timeoutMs)` consistently across schema, service, tests, and runtime injection.
