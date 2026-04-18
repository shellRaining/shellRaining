import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CronJob } from "../src/cron/types.js";
import type { CronServiceDeps } from "../src/cron/service.js";

type StoredData = { version: 1; jobs: CronJob[] };
type TimeoutCallback = () => void;
type RuntimePrompt = CronServiceDeps["runtime"]["prompt"];
type Deliver = CronServiceDeps["deliver"];
type WorkspaceForThreadKey = CronServiceDeps["workspaceForThreadKey"];
type SetTimeoutFn = CronServiceDeps["setTimeoutFn"];
type ClearTimeoutFn = CronServiceDeps["clearTimeoutFn"];
type RuntimePromptMock = Mock<RuntimePrompt>;
type DeliverMock = Mock<Deliver>;
type WorkspaceForThreadKeyMock = Mock<WorkspaceForThreadKey>;
type SetTimeoutFnMock = Mock<SetTimeoutFn>;
type ClearTimeoutFnMock = Mock<ClearTimeoutFn>;
type ExecCommand = CronServiceDeps["execCommand"];
type ExecCommandMock = Mock<ExecCommand>;

function createJob(overrides: Partial<CronJob> = {}): CronJob {
  const base: CronJob = {
    id: "job-1",
    name: "Daily summary",
    chatId: 42,
    threadId: "telegram:42",
    threadKey: "telegram__42",
    enabled: true,
    deleteAfterRun: false,
    createdAtMs: Date.parse("2026-04-16T09:00:00.000Z"),
    schedule: { kind: "every", everyMs: 60_000, anchorMs: Date.parse("2026-04-16T09:00:00.000Z") },
    payload: { kind: "agentTurn", message: "Send the daily summary" },
    state: {
      consecutiveErrors: 0,
      nextRunAtMs: Date.parse("2026-04-16T09:01:00.000Z"),
    },
  };

  return {
    ...base,
    ...overrides,
    payload: {
      ...base.payload,
      ...overrides.payload,
    },
    schedule: overrides.schedule ?? base.schedule,
    state: {
      ...base.state,
      ...overrides.state,
    },
  };
}

function createStore(initialJobs: CronJob[] = []) {
  let data: StoredData = {
    version: 1,
    jobs: initialJobs.map((job) => structuredClone(job)),
  };

  return {
    load: vi.fn(async () => structuredClone(data)),
    save: vi.fn(async (next: StoredData) => {
      data = structuredClone(next);
    }),
    snapshot: () => structuredClone(data.jobs),
  };
}

describe("CronService", () => {
  const nowMs = Date.parse("2026-04-16T09:00:00.000Z");

  let runtimePrompt: RuntimePromptMock;
  let deliver: DeliverMock;
  let workspaceForThreadKey: WorkspaceForThreadKeyMock;
  let setTimeoutFn: SetTimeoutFnMock;
  let clearTimeoutFn: ClearTimeoutFnMock;
  let execCommand: ExecCommandMock;
  let timeoutCallback: TimeoutCallback | undefined;

  beforeEach(() => {
    runtimePrompt = vi.fn<RuntimePrompt>(async () => ({
      artifactsOutput: "artifact",
      text: "done",
    }));
    deliver = vi.fn<Deliver>(async () => undefined);
    workspaceForThreadKey = vi.fn<WorkspaceForThreadKey>(async () => "/mock/workspace");
    timeoutCallback = undefined;
    setTimeoutFn = vi.fn<SetTimeoutFn>((callback: TimeoutCallback) => {
      timeoutCallback = callback;
      return 123 as unknown as ReturnType<typeof setTimeout>;
    });
    clearTimeoutFn = vi.fn<ClearTimeoutFn>(() => undefined);
    execCommand = vi.fn<ExecCommand>(async () => ({ exitCode: 0 }));
  });

  it("recomputes nextRunAtMs for enabled repeating jobs on startup and persists hydration changes", async () => {
    const { CronService } = await import("../src/cron/service.js");
    const stalePersistedNextRunAtMs = Date.parse("2026-04-16T08:30:00.000Z");
    const expectedHydratedNextRunAtMs = nowMs;
    const repeating = createJob({
      id: "hydrate-every",
      state: {
        consecutiveErrors: 0,
        nextRunAtMs: stalePersistedNextRunAtMs,
      },
    });
    const store = createStore([repeating]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.start();

    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        id: "hydrate-every",
        enabled: true,
        state: expect.objectContaining({
          consecutiveErrors: 0,
          nextRunAtMs: expectedHydratedNextRunAtMs,
        }),
      }),
    ]);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it("marks overdue at jobs outside the misfire grace window as missed on startup", async () => {
    const { CronService } = await import("../src/cron/service.js");
    const store = createStore([
      createJob({
        id: "missed-at",
        schedule: { kind: "at", at: "2026-04-16T08:40:00.000Z" },
        deleteAfterRun: true,
        state: {
          consecutiveErrors: 0,
          nextRunAtMs: Date.parse("2026-04-16T08:40:00.000Z"),
        },
      }),
    ]);

    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.start();

    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        id: "missed-at",
        enabled: false,
        state: expect.objectContaining({
          consecutiveErrors: 0,
          lastError: "Missed scheduled run while service was offline",
          lastRunStatus: "missed",
          nextRunAtMs: undefined,
        }),
      }),
    ]);
    expect(runtimePrompt).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("adds jobs with their initial next run and removes them by id", async () => {
    const { CronService } = await import("../src/cron/service.js");
    const store = createStore();
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });
    const added = createJob({ state: { consecutiveErrors: 0 } });

    await service.add(added);
    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        id: added.id,
        state: expect.objectContaining({
          consecutiveErrors: 0,
          nextRunAtMs: Date.parse("2026-04-16T09:00:00.000Z"),
        }),
      }),
    ]);

    await service.remove(added.id);
    expect(store.snapshot()).toEqual([]);
  });

  it("delivers runtime output and removes one-shot jobs after a successful run", async () => {
    const { CronService } = await import("../src/cron/service.js");
    runtimePrompt.mockResolvedValue({ text: "", error: undefined });
    const oneShot = createJob({
      id: "at-success",
      schedule: { kind: "at", at: "2026-04-16T09:00:00.000Z" },
      deleteAfterRun: true,
      state: {
        consecutiveErrors: 2,
        lastError: "previous",
        nextRunAtMs: Date.parse("2026-04-16T09:00:00.000Z"),
      },
    });
    const store = createStore([oneShot]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.run(oneShot.id);

    expect(workspaceForThreadKey).toHaveBeenCalledWith("telegram__42");
    expect(runtimePrompt).toHaveBeenCalledWith(
      "telegram__42",
      "Send the daily summary",
      "/mock/workspace",
    );
    expect(deliver).toHaveBeenCalledWith("telegram:42", "(no output)");
    expect(store.snapshot()).toEqual([]);
  });

  it("appends the current time line before running cron payloads", async () => {
    const { CronService } = await import("../src/cron/service.js");
    const job = createJob({
      id: "cron-time-aware",
      schedule: { kind: "cron", expr: "0 23 * * *", tz: "Asia/Shanghai" },
      payload: {
        kind: "agentTurn",
        message: "请帮我整理今天完成的事情，并生成简短日记草稿。",
      },
      state: {
        consecutiveErrors: 0,
        nextRunAtMs: nowMs,
      },
    });
    const store = createStore([job]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.run(job.id);

    expect(runtimePrompt).toHaveBeenCalledWith(
      "telegram__42",
      expect.stringContaining("Current time:"),
      "/mock/workspace",
    );
    expect(runtimePrompt.mock.calls[0]?.[1]).toContain(
      "请帮我整理今天完成的事情，并生成简短日记草稿。",
    );
    expect(runtimePrompt.mock.calls[0]?.[1]).toContain("Current time: Thu");
    expect(runtimePrompt.mock.calls[0]?.[1]).toContain("Asia/Shanghai");
    expect(runtimePrompt.mock.calls[0]?.[1]).toContain("UTC");
  });

  it("does not append the current time line twice", async () => {
    const { CronService } = await import("../src/cron/service.js");
    const job = createJob({
      id: "cron-time-aware-dedupe",
      schedule: { kind: "cron", expr: "0 23 * * *", tz: "Asia/Shanghai" },
      payload: {
        kind: "agentTurn",
        message:
          "请帮我整理今天完成的事情，并生成简短日记草稿。\nCurrent time: Thu 2026-04-16 17:00 Asia/Shanghai / 2026-04-16 09:00 UTC",
      },
      state: {
        consecutiveErrors: 0,
        nextRunAtMs: nowMs,
      },
    });
    const store = createStore([job]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.run(job.id);

    expect(runtimePrompt).toHaveBeenCalledTimes(1);
    expect((runtimePrompt.mock.calls[0]?.[1].match(/Current time:/g) ?? []).length).toBe(1);
  });

  it("still appends a time line when the payload only mentions Current time text", async () => {
    const { CronService } = await import("../src/cron/service.js");
    const job = createJob({
      id: "cron-time-mentioned-in-body",
      schedule: { kind: "cron", expr: "0 23 * * *", tz: "Asia/Shanghai" },
      payload: {
        kind: "agentTurn",
        message: "请把提示词里的 Current time: 改成 Now:，然后继续整理今天的事情。",
      },
      state: {
        consecutiveErrors: 0,
        nextRunAtMs: nowMs,
      },
    });
    const store = createStore([job]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.run(job.id);

    expect((runtimePrompt.mock.calls[0]?.[1].match(/Current time:/g) ?? []).length).toBe(2);
    expect(runtimePrompt.mock.calls[0]?.[1]).toContain("Current time: Thu");
  });

  it("uses the local timezone weekday when local time crosses into the next day", async () => {
    const { CronService } = await import("../src/cron/service.js");
    const crossDayNowMs = Date.parse("2026-04-16T23:30:00.000Z");
    const job = createJob({
      id: "cron-cross-day-weekday",
      schedule: { kind: "cron", expr: "30 7 * * *", tz: "Asia/Shanghai" },
      state: {
        consecutiveErrors: 0,
        nextRunAtMs: crossDayNowMs,
      },
    });
    const store = createStore([job]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => crossDayNowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.run(job.id);

    expect(runtimePrompt.mock.calls[0]?.[1]).toContain(
      "Current time: Fri 2026-04-17 07:30 Asia/Shanghai / 2026-04-16 23:30 UTC",
    );
  });

  it("applies retry backoff after failures for repeating jobs", async () => {
    const { CronService } = await import("../src/cron/service.js");
    runtimePrompt.mockResolvedValue({ text: "", error: "boom" });
    const repeating = createJob({
      id: "repeat-failure",
      state: {
        consecutiveErrors: 1,
        nextRunAtMs: nowMs,
      },
    });
    const store = createStore([repeating]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.run(repeating.id);

    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        id: "repeat-failure",
        enabled: true,
        state: expect.objectContaining({
          lastRunAtMs: nowMs,
          lastRunStatus: "error",
          lastError: "boom",
          consecutiveErrors: 2,
          nextRunAtMs: Date.parse("2026-04-16T09:02:00.000Z"),
        }),
      }),
    ]);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("disables at jobs after three failed attempts", async () => {
    const { CronService } = await import("../src/cron/service.js");
    runtimePrompt.mockRejectedValue(new Error("network down"));
    const oneShot = createJob({
      id: "at-failure",
      schedule: { kind: "at", at: "2026-04-16T09:00:00.000Z" },
      deleteAfterRun: true,
      state: {
        consecutiveErrors: 2,
        nextRunAtMs: nowMs,
      },
    });
    const store = createStore([oneShot]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.run(oneShot.id);

    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        id: "at-failure",
        enabled: false,
        state: expect.objectContaining({
          lastRunAtMs: nowMs,
          lastRunStatus: "error",
          lastError: "network down",
          consecutiveErrors: 3,
          nextRunAtMs: undefined,
        }),
      }),
    ]);
  });

  it("runs due jobs and reschedules the next timer", async () => {
    const { CronService } = await import("../src/cron/service.js");
    const due = createJob({
      id: "due-now",
      state: {
        consecutiveErrors: 0,
        nextRunAtMs: nowMs,
      },
    });
    const later = createJob({
      id: "later",
      schedule: { kind: "every", everyMs: 60_000, anchorMs: nowMs + 10 * 60_000 },
      state: {
        consecutiveErrors: 0,
        nextRunAtMs: nowMs + 10 * 60_000,
      },
    });
    const store = createStore([due, later]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.start();
    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(setTimeoutFn).toHaveBeenLastCalledWith(expect.any(Function), 0);

    runtimePrompt.mockClear();
    deliver.mockClear();
    setTimeoutFn.mockClear();

    await service.runDueJobs();

    expect(runtimePrompt).toHaveBeenCalledTimes(1);
    expect(runtimePrompt).toHaveBeenCalledWith(
      "telegram__42",
      "Send the daily summary",
      "/mock/workspace",
    );
    expect(deliver).toHaveBeenCalledWith("telegram:42", "done");
    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        id: "due-now",
        state: expect.objectContaining({
          lastRunStatus: "success",
          nextRunAtMs: Date.parse("2026-04-16T09:01:00.000Z"),
        }),
      }),
      expect.objectContaining({
        id: "later",
        state: expect.objectContaining({
          nextRunAtMs: nowMs + 10 * 60_000,
        }),
      }),
    ]);
    expect(setTimeoutFn).toHaveBeenCalledTimes(2);
    expect(setTimeoutFn.mock.calls.map((call: Parameters<SetTimeoutFn>) => call[1])).toEqual([
      5_000, 60_000,
    ]);
    expect(timeoutCallback).toEqual(expect.any(Function));
  });

  it("runs the payload when condition exits 0", async () => {
    const { CronService } = await import("../src/cron/service.js");
    execCommand.mockResolvedValue({ exitCode: 0 });
    const job = createJob({
      id: "cond-pass",
      condition: { command: "test -f marker" },
      state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
    });
    const store = createStore([job]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.run(job.id);

    expect(execCommand).toHaveBeenCalledWith("test -f marker", "/mock/workspace", 30_000);
    expect(runtimePrompt).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("silently skips when condition exits 1", async () => {
    const { CronService } = await import("../src/cron/service.js");
    execCommand.mockResolvedValue({ exitCode: 1 });
    const job = createJob({
      id: "cond-skip",
      condition: { command: "test -f marker" },
      state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
    });
    const store = createStore([job]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    const result = await service.run(job.id);

    expect(runtimePrompt).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: "cond-skip",
        state: expect.objectContaining({
          nextRunAtMs: Date.parse("2026-04-16T09:01:00.000Z"),
        }),
      }),
    );
  });

  it("treats condition exit codes above 1 as failures", async () => {
    const { CronService } = await import("../src/cron/service.js");
    execCommand.mockResolvedValue({ exitCode: 2 });
    const job = createJob({
      id: "cond-fail",
      condition: { command: "bad-command" },
      state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
    });
    const store = createStore([job]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    const result = await service.run(job.id);

    expect(runtimePrompt).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: "cond-fail",
        state: expect.objectContaining({
          lastRunStatus: "error",
          lastError: "Condition command exited with code 2",
          consecutiveErrors: 1,
        }),
      }),
    );
  });

  it("treats condition execution exceptions as failures", async () => {
    const { CronService } = await import("../src/cron/service.js");
    execCommand.mockRejectedValue(new Error("spawn ENOENT"));
    const job = createJob({
      id: "cond-exception",
      condition: { command: "missing-binary" },
      state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
    });
    const store = createStore([job]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    const result = await service.run(job.id);

    expect(runtimePrompt).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: "cond-exception",
        state: expect.objectContaining({
          lastRunStatus: "error",
          lastError: "spawn ENOENT",
          consecutiveErrors: 1,
        }),
      }),
    );
  });

  it("uses the default 30000ms timeout when condition.timeoutMs is omitted", async () => {
    const { CronService } = await import("../src/cron/service.js");
    execCommand.mockResolvedValue({ exitCode: 0 });
    const job = createJob({
      id: "cond-default-timeout",
      condition: { command: "echo ok" },
      state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
    });
    const store = createStore([job]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    await service.run(job.id);

    expect(execCommand).toHaveBeenCalledWith("echo ok", "/mock/workspace", 30_000);
  });

  it("treats signal-killed condition processes as failures", async () => {
    const { CronService } = await import("../src/cron/service.js");
    execCommand.mockResolvedValue({ exitCode: null, signal: "SIGKILL" });
    const job = createJob({
      id: "cond-signal",
      condition: { command: "heavy-command" },
      state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
    });
    const store = createStore([job]);
    const service = new CronService({
      store,
      runtime: { prompt: runtimePrompt },
      deliver,
      workspaceForThreadKey,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
      execCommand,
    });

    const result = await service.run(job.id);

    expect(runtimePrompt).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: "cond-signal",
        state: expect.objectContaining({
          lastRunStatus: "error",
          lastError: "Condition command terminated by signal SIGKILL",
          consecutiveErrors: 1,
        }),
      }),
    );
  });
});
