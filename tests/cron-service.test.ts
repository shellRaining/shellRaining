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
  let timeoutCallback: TimeoutCallback | undefined;

  beforeEach(() => {
    runtimePrompt = vi.fn<RuntimePrompt>(async () => ({ artifactsOutput: "artifact", text: "done" }));
    deliver = vi.fn<Deliver>(async () => undefined);
    workspaceForThreadKey = vi.fn<WorkspaceForThreadKey>(async () => "/mock/workspace");
    timeoutCallback = undefined;
    setTimeoutFn = vi.fn<SetTimeoutFn>((callback: TimeoutCallback) => {
      timeoutCallback = callback;
      return 123 as unknown as ReturnType<typeof setTimeout>;
    });
    clearTimeoutFn = vi.fn<ClearTimeoutFn>(() => undefined);
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
    });

    await service.run(oneShot.id);

    expect(workspaceForThreadKey).toHaveBeenCalledWith("telegram__42");
    expect(runtimePrompt).toHaveBeenCalledWith("telegram__42", "Send the daily summary", "/mock/workspace");
    expect(deliver).toHaveBeenCalledWith(42, "(no output)");
    expect(store.snapshot()).toEqual([]);
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
    });

    await service.start();
    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(setTimeoutFn).toHaveBeenLastCalledWith(expect.any(Function), 0);

    runtimePrompt.mockClear();
    deliver.mockClear();
    setTimeoutFn.mockClear();

    await service.runDueJobs();

    expect(runtimePrompt).toHaveBeenCalledTimes(1);
    expect(runtimePrompt).toHaveBeenCalledWith("telegram__42", "Send the daily summary", "/mock/workspace");
    expect(deliver).toHaveBeenCalledWith(42, "done");
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
    expect(setTimeoutFn.mock.calls.map((call: Parameters<SetTimeoutFn>) => call[1])).toEqual([5_000, 60_000]);
    expect(timeoutCallback).toEqual(expect.any(Function));
  });
});
