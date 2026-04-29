import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CronJob, CronServiceDeps, CronStoreData } from "../src/index.js";

interface TestPayload {
  kind: "test";
  message: string;
}

interface TestOwner {
  tenantId: string;
}

type TestJob = CronJob<TestPayload, TestOwner>;
type StoredData = CronStoreData<TestPayload, TestOwner>;
type TimeoutCallback = () => void;
type Execute = CronServiceDeps<TestPayload, TestOwner>["execute"];
type RunCondition = CronServiceDeps<TestPayload, TestOwner>["runCondition"];
type SetTimeoutFn = CronServiceDeps<TestPayload, TestOwner>["setTimeoutFn"];
type ClearTimeoutFn = CronServiceDeps<TestPayload, TestOwner>["clearTimeoutFn"];

function createJob(overrides: Partial<TestJob> = {}): TestJob {
  const base: TestJob = {
    id: "job-1",
    name: "Daily summary",
    owner: { tenantId: "tenant-1" },
    enabled: true,
    removeAfterSuccess: false,
    createdAtMs: Date.parse("2026-04-16T09:00:00.000Z"),
    schedule: { kind: "every", everyMs: 60_000, anchorMs: Date.parse("2026-04-16T09:00:00.000Z") },
    payload: { kind: "test", message: "Send the daily summary" },
    state: {
      consecutiveErrors: 0,
      nextRunAtMs: Date.parse("2026-04-16T09:01:00.000Z"),
    },
  };

  return {
    ...base,
    ...overrides,
    owner: {
      ...base.owner,
      ...overrides.owner,
    },
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

function createStore(initialJobs: TestJob[] = []) {
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

  let execute: Mock<Execute>;
  let runCondition: Mock<RunCondition>;
  let setTimeoutFn: Mock<SetTimeoutFn>;
  let clearTimeoutFn: Mock<ClearTimeoutFn>;
  let timeoutCallback: TimeoutCallback | undefined;

  beforeEach(() => {
    execute = vi.fn<Execute>(async () => ({ status: "success" }));
    runCondition = vi.fn<RunCondition>(async () => ({ status: "pass" }));
    timeoutCallback = undefined;
    setTimeoutFn = vi.fn<SetTimeoutFn>((callback: TimeoutCallback) => {
      timeoutCallback = callback;
      return 123 as unknown as ReturnType<typeof setTimeout>;
    });
    clearTimeoutFn = vi.fn<ClearTimeoutFn>(() => undefined);
  });

  it("runs generic payloads through injected execute and removes one-shot jobs after success", async () => {
    const { CronService } = await import("../src/index.js");
    const oneShot = createJob({
      id: "at-success",
      schedule: { kind: "at", at: "2026-04-16T09:00:00.000Z" },
      removeAfterSuccess: true,
      state: {
        consecutiveErrors: 2,
        lastError: "previous",
        nextRunAtMs: nowMs,
      },
    });
    const store = createStore([oneShot]);
    const service = new CronService<TestPayload, TestOwner>({
      store,
      execute,
      runCondition,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
    });

    await service.run(oneShot.id);

    expect(execute).toHaveBeenCalledWith(oneShot, nowMs);
    expect(store.snapshot()).toEqual([]);
  });

  it("passes condition data and whole job to injected condition runner", async () => {
    const { CronService } = await import("../src/index.js");
    const job = createJob({
      id: "cond-pass",
      condition: { command: "test -f marker" },
      state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
    });
    const store = createStore([job]);
    const service = new CronService<TestPayload, TestOwner>({
      store,
      execute,
      runCondition,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
    });

    await service.run(job.id);

    expect(runCondition).toHaveBeenCalledWith(job.condition, job);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("silently skips when an injected condition returns skip", async () => {
    const { CronService } = await import("../src/index.js");
    runCondition.mockResolvedValue({ status: "skip" });
    const job = createJob({
      id: "cond-skip",
      condition: { command: "test -f marker" },
      state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
    });
    const store = createStore([job]);
    const service = new CronService<TestPayload, TestOwner>({
      store,
      execute,
      runCondition,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
    });

    const result = await service.run(job.id);

    expect(execute).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: "cond-skip",
        state: expect.objectContaining({
          nextRunAtMs: Date.parse("2026-04-16T09:01:00.000Z"),
        }),
      }),
    );
  });

  it("stores condition errors as job failures", async () => {
    const { CronService } = await import("../src/index.js");
    runCondition.mockResolvedValue({ status: "error", error: "Condition command exited with code 2" });
    const job = createJob({
      id: "cond-fail",
      condition: { command: "bad-command" },
      state: { consecutiveErrors: 0, nextRunAtMs: nowMs },
    });
    const store = createStore([job]);
    const service = new CronService<TestPayload, TestOwner>({
      store,
      execute,
      runCondition,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
    });

    const result = await service.run(job.id);

    expect(execute).not.toHaveBeenCalled();
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

  it("applies retry backoff after injected execution failures", async () => {
    const { CronService } = await import("../src/index.js");
    execute.mockResolvedValue({ status: "error", error: "boom" });
    const repeating = createJob({
      id: "repeat-failure",
      state: {
        consecutiveErrors: 1,
        nextRunAtMs: nowMs,
      },
    });
    const store = createStore([repeating]);
    const service = new CronService<TestPayload, TestOwner>({
      store,
      execute,
      runCondition,
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
  });

  it("runs due jobs and reschedules the next timer", async () => {
    const { CronService } = await import("../src/index.js");
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
    const service = new CronService<TestPayload, TestOwner>({
      store,
      execute,
      runCondition,
      now: () => nowMs,
      setTimeoutFn,
      clearTimeoutFn,
      runTimeoutMs: 5_000,
      misfireGraceMs: 5 * 60_000,
    });

    await service.start();
    setTimeoutFn.mockClear();
    await service.runDueJobs();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(due, nowMs);
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
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(timeoutCallback).toEqual(expect.any(Function));
  });
});
