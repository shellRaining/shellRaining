import { applyErrorBackoff, computeNextRunAtMs } from "./schedule.js";
import { findEarliestNextRunAtMs, planTimerDelayMs } from "./timer.js";
import type {
  CronCondition,
  CronConditionResult,
  CronExecutionResult,
  CronJob,
  CronStoreData,
} from "./types.js";

export interface CronServiceStore<TPayload = unknown, TOwner = unknown> {
  load(): Promise<CronStoreData<TPayload, TOwner>>;
  save(data: CronStoreData<TPayload, TOwner>): Promise<void>;
}

export interface CronServiceDeps<TPayload = unknown, TOwner = unknown> {
  store: CronServiceStore<TPayload, TOwner>;
  execute: (job: CronJob<TPayload, TOwner>, nowMs: number) => Promise<CronExecutionResult>;
  runCondition: (
    condition: CronCondition,
    job: CronJob<TPayload, TOwner>,
  ) => Promise<CronConditionResult>;
  now: () => number;
  setTimeoutFn: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => void;
  runTimeoutMs: number;
  misfireGraceMs: number;
}

export class CronService<TPayload = unknown, TOwner = unknown> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private runningDueJobs: Promise<void> | undefined;

  constructor(private readonly deps: CronServiceDeps<TPayload, TOwner>) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    await this.hydrateStartupJobs();
    await this.scheduleNextTimer();
  }

  stop(): void {
    this.started = false;
    this.clearTimer();
  }

  async listJobs(): Promise<CronJob<TPayload, TOwner>[]> {
    const data = await this.deps.store.load();
    return data.jobs;
  }

  async add(job: CronJob<TPayload, TOwner>): Promise<CronJob<TPayload, TOwner>> {
    const data = await this.deps.store.load();
    const nowMs = this.deps.now();
    const nextJob: CronJob<TPayload, TOwner> = {
      ...job,
      state: {
        ...job.state,
        nextRunAtMs: computeNextRunAtMs(job.schedule, nowMs),
      },
    };

    await this.deps.store.save({
      ...data,
      jobs: [...data.jobs, nextJob],
    });
    await this.scheduleNextTimer();
    return nextJob;
  }

  async remove(jobId: string): Promise<boolean> {
    const data = await this.deps.store.load();
    const jobs = data.jobs.filter((job) => job.id !== jobId);
    if (jobs.length === data.jobs.length) {
      return false;
    }

    await this.deps.store.save({
      ...data,
      jobs,
    });
    await this.scheduleNextTimer();
    return true;
  }

  async run(jobId: string): Promise<CronJob<TPayload, TOwner> | undefined> {
    return this.runJob(jobId, true);
  }

  async runDueJobs(): Promise<void> {
    if (this.runningDueJobs) {
      return this.runningDueJobs;
    }

    this.runningDueJobs = this.runDueJobsInternal();
    try {
      await this.runningDueJobs;
    } finally {
      this.runningDueJobs = undefined;
    }
  }

  private async runDueJobsInternal(): Promise<void> {
    const data = await this.deps.store.load();
    const nowMs = this.deps.now();
    const dueJobs = data.jobs
      .filter(
        (job) =>
          job.enabled && job.state.nextRunAtMs !== undefined && job.state.nextRunAtMs <= nowMs,
      )
      .sort((left, right) => (left.state.nextRunAtMs ?? 0) - (right.state.nextRunAtMs ?? 0));

    for (const job of dueJobs) {
      await this.runJob(job.id, false);
    }

    await this.scheduleNextTimer();
  }

  private async runJob(
    jobId: string,
    rescheduleAfterRun: boolean,
  ): Promise<CronJob<TPayload, TOwner> | undefined> {
    const data = await this.deps.store.load();
    const job = data.jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      return undefined;
    }

    const nowMs = this.deps.now();

    try {
      if (job.condition) {
        const condResult = await this.deps.runCondition(job.condition, job);
        if (condResult.status === "skip") {
          const updated: CronJob<TPayload, TOwner> = {
            ...job,
            state: {
              ...job.state,
              nextRunAtMs: computeNextRunAtMs(job.schedule, nowMs + 1),
            },
          };
          await this.saveUpdatedJob(data, updated);
          if (rescheduleAfterRun) {
            await this.scheduleNextTimer();
          }
          return updated;
        }

        if (condResult.status === "error") {
          const updated = this.buildFailureJob(job, nowMs, condResult.error);
          await this.saveUpdatedJob(data, updated);
          if (rescheduleAfterRun) {
            await this.scheduleNextTimer();
          }
          return updated;
        }
      }

      const result = await this.runWithTimeout(() => this.deps.execute(job, nowMs));
      if (result.status === "error") {
        const updated = this.buildFailureJob(job, nowMs, result.error);
        await this.saveUpdatedJob(data, updated);
        if (rescheduleAfterRun) {
          await this.scheduleNextTimer();
        }
        return updated;
      }

      const updated: CronJob<TPayload, TOwner> = {
        ...job,
        state: {
          ...job.state,
          lastRunAtMs: nowMs,
          lastRunStatus: "success",
          lastError: undefined,
          consecutiveErrors: 0,
        },
      };

      if (job.removeAfterSuccess) {
        await this.deps.store.save({
          ...data,
          jobs: data.jobs.filter((candidate) => candidate.id !== job.id),
        });
        if (rescheduleAfterRun) {
          await this.scheduleNextTimer();
        }
        return undefined;
      }

      updated.state.nextRunAtMs = computeNextRunAtMs(job.schedule, nowMs + 1);
      await this.saveUpdatedJob(data, updated);
      if (rescheduleAfterRun) {
        await this.scheduleNextTimer();
      }
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = this.buildFailureJob(job, nowMs, message);
      await this.saveUpdatedJob(data, updated);
      if (rescheduleAfterRun) {
        await this.scheduleNextTimer();
      }
      return updated;
    }
  }

  private async hydrateStartupJobs(): Promise<void> {
    const data = await this.deps.store.load();
    const nowMs = this.deps.now();
    let changed = false;

    const jobs = data.jobs.map((job) => {
      if (!job.enabled) {
        return job;
      }

      if (job.schedule.kind === "at") {
        const scheduledAtMs = Date.parse(job.schedule.at);
        if (Number.isFinite(scheduledAtMs) && nowMs - scheduledAtMs > this.deps.misfireGraceMs) {
          changed = true;
          return {
            ...job,
            enabled: false,
            state: {
              ...job.state,
              lastRunStatus: "missed" as const,
              lastError: "Missed scheduled run while service was offline",
              nextRunAtMs: undefined,
            },
          };
        }
      }

      const nextRunAtMs = computeNextRunAtMs(job.schedule, nowMs);
      if (job.state.nextRunAtMs === nextRunAtMs) {
        return job;
      }

      changed = true;
      return {
        ...job,
        state: {
          ...job.state,
          nextRunAtMs,
        },
      };
    });

    if (!changed) {
      return;
    }

    await this.deps.store.save({
      ...data,
      jobs,
    });
  }

  private buildFailureJob(
    job: CronJob<TPayload, TOwner>,
    nowMs: number,
    errorMessage: string,
  ): CronJob<TPayload, TOwner> {
    const consecutiveErrors = job.state.consecutiveErrors + 1;
    const updated: CronJob<TPayload, TOwner> = {
      ...job,
      state: {
        ...job.state,
        lastRunAtMs: nowMs,
        lastRunStatus: "error",
        lastError: errorMessage,
        consecutiveErrors,
      },
    };

    if (job.schedule.kind === "at" && consecutiveErrors >= 3) {
      updated.enabled = false;
      updated.state.nextRunAtMs = undefined;
      return updated;
    }

    const normalNext = job.schedule.kind === "at" ? nowMs : computeNextRunAtMs(job.schedule, nowMs);
    updated.state.nextRunAtMs = applyErrorBackoff(normalNext, consecutiveErrors, nowMs);
    return updated;
  }

  private async saveUpdatedJob(
    data: CronStoreData<TPayload, TOwner>,
    job: CronJob<TPayload, TOwner>,
  ): Promise<void> {
    await this.deps.store.save({
      ...data,
      jobs: data.jobs.map((candidate) => (candidate.id === job.id ? job : candidate)),
    });
  }

  private async scheduleNextTimer(): Promise<void> {
    this.clearTimer();
    if (!this.started) {
      return;
    }

    const jobs = await this.listJobs();
    const nextRunAtMs = findEarliestNextRunAtMs(jobs);
    if (nextRunAtMs === undefined) {
      return;
    }

    const delayMs = planTimerDelayMs(nextRunAtMs, this.deps.now());
    this.timer = this.deps.setTimeoutFn(() => {
      void this.runDueJobs();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === undefined) {
      return;
    }

    this.deps.clearTimeoutFn(this.timer);
    this.timer = undefined;
  }

  private async runWithTimeout<T>(work: () => Promise<T>): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        work(),
        new Promise<T>((_, reject) => {
          timeoutHandle = this.deps.setTimeoutFn(() => {
            reject(new Error(`Cron job exceeded timeout of ${this.deps.runTimeoutMs}ms`));
          }, this.deps.runTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle !== undefined) {
        this.deps.clearTimeoutFn(timeoutHandle);
      }
    }
  }
}
